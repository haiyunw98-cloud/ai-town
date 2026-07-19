import { cronJobs } from 'convex/server';
import { DELETE_BATCH_SIZE, IDLE_WORLD_TIMEOUT, VACUUM_MAX_AGE } from './constants';
import { internal } from './_generated/api';
import { internalMutation, MutationCtx } from './_generated/server';
import { TableNames } from './_generated/dataModel';
import { v } from 'convex/values';

const crons = cronJobs();

export const ACTIVITY_REGISTRATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const ACTIVITY_REGISTRATION_ACK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

crons.interval(
  'stop inactive worlds',
  { seconds: IDLE_WORLD_TIMEOUT / 1000 },
  internal.world.stopInactiveWorlds,
);

crons.interval('restart dead worlds', { seconds: 60 }, internal.world.restartDeadWorlds);

crons.interval('advance daily town activity', { seconds: 30 }, internal.events.advanceActiveEvents);

crons.interval(
  'advance daily town economy',
  { seconds: 60 },
  internal.townEconomy.advanceDailyEconomyTick,
  {},
);

crons.daily('vacuum old entries', { hourUTC: 4, minuteUTC: 20 }, internal.crons.vacuumOldEntries);

export default crons;

const TablesToVacuum: TableNames[] = [
  // Un-comment this to also clean out old conversations.
  // 'conversationMembers', 'conversations', 'messages',

  // Inputs aren't useful unless you're trying to replay history.
  // If you want to support that, you should add a snapshot table, so you can
  // replay from a certain time period. Or stop vacuuming inputs and replay from
  // the beginning of time
  'inputs',

  // We can keep memories without their embeddings for inspection, but we won't
  // retrieve them when searching memories via vector search.
  'memories',
  // We can vacuum fewer tables without serious consequences, but the only
  // one that will cause issues over time is having >>100k vectors.
  'memoryEmbeddings',
];

export const vacuumOldEntries = internalMutation({
  args: {},
  handler: async (ctx, _args) => {
    const before = Date.now() - VACUUM_MAX_AGE;
    for (const tableName of TablesToVacuum) {
      console.log(`Checking ${tableName}...`);
      const exists = await ctx.db
        .query(tableName)
        .withIndex('by_creation_time', (q) => q.lt('_creationTime', before))
        .first();
      if (exists) {
        console.log(`Vacuuming ${tableName}...`);
        await ctx.scheduler.runAfter(0, internal.crons.vacuumTable, {
          tableName,
          before,
          cursor: null,
          soFar: 0,
        });
      }
    }
    const beforeAck = Date.now() - ACTIVITY_REGISTRATION_ACK_RETENTION_MS;
    for (const status of ['processed', 'dead-letter'] as const) {
      await ctx.scheduler.runAfter(0, internal.crons.vacuumActivityRegistrationAcks, {
        status,
        before: beforeAck,
        cursor: null,
      });
    }
    const beforeRegistration = Date.now() - ACTIVITY_REGISTRATION_RETENTION_MS;
    for (const state of ['activated', 'abandoned'] as const) {
      await ctx.scheduler.runAfter(0, internal.crons.vacuumActivityRegistrations, {
        state,
        before: beforeRegistration,
        cursor: null,
      });
    }
  },
});

export const vacuumActivityRegistrationAcks = internalMutation({
  args: {
    status: v.union(v.literal('processed'), v.literal('dead-letter')),
    before: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: vacuumActivityRegistrationAckPage,
});

export async function vacuumActivityRegistrationAckPage(
  ctx: Pick<MutationCtx, 'db' | 'scheduler'>,
  args: {
    status: 'processed' | 'dead-letter';
    before: number;
    cursor: string | null;
  },
) {
  const results = await ctx.db
    .query('activityRegistrationAcks')
    .withIndex('statusUpdatedAt', (q) =>
      q.eq('status', args.status).lt('updatedAt', args.before),
    )
    .paginate({ cursor: args.cursor, numItems: DELETE_BATCH_SIZE });
  for (const outbox of results.page) {
    await ctx.db.delete(outbox._id);
  }
  if (!results.isDone) {
    await ctx.scheduler.runAfter(0, internal.crons.vacuumActivityRegistrationAcks, {
      ...args,
      cursor: results.continueCursor,
    });
  }
  return { deleted: results.page.length, done: results.isDone };
}

export const vacuumActivityRegistrations = internalMutation({
  args: {
    state: v.union(v.literal('activated'), v.literal('abandoned')),
    before: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: vacuumActivityRegistrationPage,
});

export async function vacuumActivityRegistrationPage(
  ctx: Pick<MutationCtx, 'db' | 'scheduler'>,
  args: {
    state: 'activated' | 'abandoned';
    before: number;
    cursor: string | null;
  },
) {
  const results = await ctx.db
    .query('activityRegistrations')
    .withIndex('stateUpdatedAt', (q) =>
      q.eq('state', args.state).lt('updatedAt', args.before),
    )
    .paginate({ cursor: args.cursor, numItems: DELETE_BATCH_SIZE });
  let deleted = 0;
  for (const registration of results.page) {
    let safeToDelete = registration.state === 'abandoned'
      && (
        registration.abandonReason === 'operation-replaced'
        || registration.abandonReason === 'engine-input-error'
        || registration.abandonReason === 'ack-processing-failed'
      );
    if (registration.state === 'activated') {
      const [complete, failed, start] = await Promise.all(['complete', 'failed', 'start'].map((phase) =>
        ctx.db
          .query('lifeEvents')
          .withIndex('sourceKey', (q) =>
            q.eq('worldId', registration.worldId)
              .eq('sourceKey', `activity:${registration.operationId}:${phase}`),
          )
          .unique(),
      ));
      const acknowledgedNonfinancialStart = registration.economicActionJson === undefined
        && registration.deliveryState === 'processed'
        && registration.activatedAt !== undefined
        && registration.activityUntil !== undefined
        && registration.activityUntil <= args.before + ACTIVITY_REGISTRATION_RETENTION_MS
        && start?.residentId === registration.residentId
        && start.operationId === registration.operationId
        && start.phase === 'start'
        && start.category === registration.category
        && start.landmarkId === registration.landmarkId
        && start.economicActionJson === undefined
        && start.activityUntil === registration.activityUntil
        && start.createdAt === registration.activatedAt
        && start.text === `开始${registration.activityText}`;
      safeToDelete = !!complete || !!failed || acknowledgedNonfinancialStart;
      if (acknowledgedNonfinancialStart && registration.inputId) {
        const input = await ctx.db.get(registration.inputId);
        const inputRegistrationId = input?.name === 'finishDoSomething'
          && input.args && typeof input.args === 'object'
          ? (input.args as { activityRegistrationId?: unknown }).activityRegistrationId
          : undefined;
        if (input && inputRegistrationId === registration._id) await ctx.db.delete(input._id);
      }
    }
    if (safeToDelete) {
      await ctx.db.delete(registration._id);
      deleted += 1;
    }
  }
  if (!results.isDone) {
    await ctx.scheduler.runAfter(0, internal.crons.vacuumActivityRegistrations, {
      ...args,
      cursor: results.continueCursor,
    });
  }
  return { deleted, done: results.isDone };
}

export async function vacuumInputPage(
  ctx: Pick<MutationCtx, 'db' | 'scheduler'>,
  args: { before: number; cursor: string | null; soFar: number },
) {
  const results = await ctx.db
    .query('inputs')
    .withIndex('by_creation_time', (q) => q.lt('_creationTime', args.before))
    .paginate({ cursor: args.cursor, numItems: DELETE_BATCH_SIZE });
  let deleted = 0;
  for (const input of results.page) {
    const registration = await ctx.db
      .query('activityRegistrations')
      .withIndex('inputId', (q) => q.eq('inputId', input._id))
      .unique();
    if (!registration || registration.state === 'abandoned') {
      await ctx.db.delete(input._id);
      deleted += 1;
    }
  }
  if (!results.isDone) {
    await ctx.scheduler.runAfter(0, internal.crons.vacuumTable, {
      tableName: 'inputs',
      before: args.before,
      cursor: results.continueCursor,
      soFar: args.soFar + deleted,
    });
  }
  return { deleted, done: results.isDone };
}

export const vacuumTable = internalMutation({
  args: {
    tableName: v.string(),
    before: v.number(),
    cursor: v.union(v.string(), v.null()),
    soFar: v.number(),
  },
  handler: async (ctx, { tableName, before, cursor, soFar }) => {
    if (tableName === 'inputs') {
      return vacuumInputPage(ctx, { before, cursor, soFar });
    }
    const results = await ctx.db
      .query(tableName as TableNames)
      .withIndex('by_creation_time', (q) => q.lt('_creationTime', before))
      .paginate({ cursor, numItems: DELETE_BATCH_SIZE });
    for (const row of results.page) {
      await ctx.db.delete(row._id);
    }
    if (!results.isDone) {
      await ctx.scheduler.runAfter(0, internal.crons.vacuumTable, {
        tableName,
        before,
        soFar: results.page.length + soFar,
        cursor: results.continueCursor,
      });
    } else {
      console.log(`Vacuumed ${soFar + results.page.length} entries from ${tableName}`);
    }
  },
});
