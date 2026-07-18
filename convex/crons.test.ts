import { readFileSync } from 'node:fs';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import {
  ACTIVITY_REGISTRATION_RETENTION_MS,
  ACTIVITY_REGISTRATION_ACK_RETENTION_MS,
  vacuumActivityRegistrationAckPage,
  vacuumActivityRegistrationPage,
  vacuumInputPage,
} from './crons';

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

class VacuumDb {
  private nextId = 1;
  readonly rows = new Map<string, Row[]>();

  seed(table: string, row: Record<string, unknown>) {
    const stored = {
      _id: `${table}:${this.nextId++}`,
      _creationTime: 1,
      ...row,
    };
    this.table(table).push(stored);
    return stored;
  }

  query(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    const query = {
      withIndex: (_index: string, apply: (builder: {
        eq: (field: string, value: unknown) => unknown;
        lt: (field: string, value: number) => unknown;
      }) => unknown) => {
        const builder = {
          eq: (field: string, value: unknown) => {
            filters.push((row) => row[field] === value);
            return builder;
          },
          lt: (field: string, value: number) => {
            filters.push((row) => {
              const candidate = row[field];
              return typeof candidate === 'number' && candidate < value;
            });
            return builder;
          },
        };
        apply(builder);
        return query;
      },
      unique: () => {
        const rows = this.matching(table, filters);
        if (rows.length > 1) throw new Error(`Expected unique ${table}`);
        return Promise.resolve(rows[0] ?? null);
      },
      paginate: ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
        const page = this.matching(table, filters).slice(0, numItems);
        return Promise.resolve({
          page,
          isDone: page.length < numItems,
          continueCursor: cursor === null ? 'page:next' : 'page:again',
        });
      },
    };
    return query;
  }

  delete(id: string) {
    for (const rows of this.rows.values()) {
      const index = rows.findIndex((row) => row._id === id);
      if (index !== -1) rows.splice(index, 1);
    }
    return Promise.resolve();
  }

  table(name: string) {
    const rows = this.rows.get(name) ?? [];
    this.rows.set(name, rows);
    return rows;
  }

  private matching(table: string, filters: Array<(row: Row) => boolean>) {
    return this.table(table).filter((row) => filters.every((filter) => filter(row)));
  }
}

class VacuumScheduler {
  readonly calls: Array<{ delay: number; args: Record<string, unknown> }> = [];

  runAfter(delay: number, _reference: unknown, args: Record<string, unknown>) {
    this.calls.push({ delay, args });
    return Promise.resolve('scheduled:test');
  }
}

const worldId = 'worlds:test' as Id<'worlds'>;
const now = Date.parse('2026-07-19T12:00:00+08:00');

function registration(operationId: string, overrides: Record<string, unknown> = {}) {
  return {
    worldId,
    residentId: 'p:1',
    operationId,
    activityText: '日常活动',
    activityDuration: 60_000,
    landmarkId: 'tea-house',
    category: 'work',
    economicActionJson: '{}',
    startedAt: 1,
    state: 'activated',
    recoveryAttempts: 0,
    updatedAt: now - ACTIVITY_REGISTRATION_RETENTION_MS - 1,
    ...overrides,
  };
}

function terminalFact(db: VacuumDb, operationId: string) {
  db.seed('lifeEvents', {
    worldId,
    sourceKey: `activity:${operationId}:complete`,
    phase: 'complete',
    text: '事实永久保留',
  });
}

describe('activity registration vacuum', () => {
  test('paginates only terminal old acknowledgement rows and preserves facts', async () => {
    const db = new VacuumDb();
    const scheduler = new VacuumScheduler();
    const ctx = { db, scheduler } as unknown as MutationCtx;
    const before = now - ACTIVITY_REGISTRATION_ACK_RETENTION_MS;
    db.seed('activityRegistrationAcks', {
      status: 'pending', updatedAt: before - 1, payloadJson: '{}', attempts: 0,
    });
    db.seed('activityRegistrationAcks', {
      status: 'retrying', updatedAt: before - 1, payloadJson: '{}', attempts: 1,
    });
    db.seed('activityRegistrationAcks', {
      status: 'processed', updatedAt: before, payloadJson: '{}', attempts: 0,
    });
    for (let index = 0; index < 65; index += 1) {
      db.seed('activityRegistrationAcks', {
        status: 'processed', updatedAt: before - index - 1, payloadJson: '{}', attempts: 0,
      });
    }
    db.seed('activityRegistrationAcks', {
      status: 'dead-letter', updatedAt: before - 1, payloadJson: '{}', attempts: 3,
    });
    db.seed('lifeEvents', {
      worldId, sourceKey: 'activity:o:historical:complete', text: '事实永久保留',
    });

    expect(await vacuumActivityRegistrationAckPage(ctx, {
      status: 'processed', before, cursor: null,
    })).toEqual({ deleted: 64, done: false });
    expect(scheduler.calls).toHaveLength(1);
    expect(await vacuumActivityRegistrationAckPage(
      ctx,
      scheduler.calls[0].args as never,
    )).toEqual({ deleted: 1, done: true });
    expect(await vacuumActivityRegistrationAckPage(ctx, {
      status: 'dead-letter', before, cursor: null,
    })).toEqual({ deleted: 1, done: true });

    expect(db.table('activityRegistrationAcks').map((row) => row.status)).toEqual([
      'pending', 'retrying', 'processed',
    ]);
    expect(db.table('lifeEvents').map((row) => row.text)).toEqual(['事实永久保留']);
    expect(readFileSync('convex/crons.ts', 'utf8'))
      .toContain('internal.crons.vacuumActivityRegistrationAcks');
  });

  test('retains old inputs referenced by outstanding registrations and deletes safe inputs', async () => {
    const db = new VacuumDb();
    const scheduler = new VacuumScheduler();
    const ctx = { db, scheduler } as unknown as MutationCtx;
    const before = now - 14 * 24 * 60 * 60 * 1000;
    const pending = db.seed('inputs', { name: 'finishDoSomething' });
    const processing = db.seed('inputs', { name: 'finishDoSomething' });
    const activated = db.seed('inputs', { name: 'finishDoSomething' });
    const abandoned = db.seed('inputs', { name: 'finishDoSomething' });
    const unreferenced = db.seed('inputs', { name: 'moveTo' });
    for (const input of [pending, processing, activated, abandoned, unreferenced]) {
      input._creationTime = before - 1;
    }
    db.seed('activityRegistrations', registration('o:paused-over-14-days', {
      inputId: pending._id,
      state: 'intent',
      deliveryState: 'queued',
      updatedAt: before - 7 * 24 * 60 * 60 * 1000,
    }));
    db.seed('activityRegistrations', registration('o:processing', {
      inputId: processing._id,
      state: 'intent',
      deliveryState: 'processing',
    }));
    db.seed('activityRegistrations', registration('o:activated-outstanding', {
      inputId: activated._id,
      state: 'activated',
      deliveryState: 'processed',
    }));
    db.seed('activityRegistrations', registration('o:abandoned-terminal', {
      inputId: abandoned._id,
      state: 'abandoned',
      deliveryState: 'failed',
      abandonReason: 'engine-input-error',
    }));

    expect(await vacuumInputPage(ctx, { before, cursor: null, soFar: 0 }))
      .toEqual({ deleted: 2, done: true });
    expect(db.table('inputs').map((row) => row._id)).toEqual([
      pending._id,
      processing._id,
      activated._id,
    ]);
    expect(scheduler.calls).toHaveLength(0);
    expect(readFileSync('convex/schema.ts', 'utf8'))
      .toContain(".index('inputId', ['inputId'])");
  });

  test('cleans only old terminal activated and safely acknowledged abandoned rows', async () => {
    const db = new VacuumDb();
    const scheduler = new VacuumScheduler();
    const ctx = { db, scheduler } as unknown as MutationCtx;
    db.seed('worldStatus', { worldId, status: 'stoppedByDeveloper' });
    db.seed('activityRegistrations', registration('o:terminal'));
    terminalFact(db, 'o:terminal');
    db.seed('activityRegistrations', registration('o:no-outcome'));
    db.seed('activityRegistrations', registration('o:boundary', {
      updatedAt: now - ACTIVITY_REGISTRATION_RETENTION_MS,
    }));
    terminalFact(db, 'o:boundary');
    db.seed('activityRegistrations', registration('o:intent', { state: 'intent' }));
    db.seed('activityRegistrations', registration('o:safe-abandoned', {
      state: 'abandoned', abandonReason: 'operation-replaced',
    }));
    db.seed('activityRegistrations', registration('o:error-abandoned', {
      state: 'abandoned', abandonReason: 'engine-input-error',
    }));
    db.seed('activityRegistrations', registration('o:dead-letter-abandoned', {
      state: 'abandoned', abandonReason: 'ack-processing-failed',
    }));
    db.seed('activityRegistrations', registration('o:unsafe-abandoned', {
      state: 'abandoned', abandonReason: undefined,
    }));

    await vacuumActivityRegistrationPage(ctx, {
      state: 'activated', before: now - ACTIVITY_REGISTRATION_RETENTION_MS, cursor: null,
    });
    await vacuumActivityRegistrationPage(ctx, {
      state: 'abandoned', before: now - ACTIVITY_REGISTRATION_RETENTION_MS, cursor: null,
    });

    const operations = db.table('activityRegistrations').map((row) => row.operationId);
    expect(operations).not.toContain('o:terminal');
    expect(operations).not.toContain('o:safe-abandoned');
    expect(operations).not.toContain('o:error-abandoned');
    expect(operations).not.toContain('o:dead-letter-abandoned');
    expect(operations).toEqual(expect.arrayContaining([
      'o:no-outcome', 'o:boundary', 'o:intent', 'o:unsafe-abandoned',
    ]));
    expect(db.table('lifeEvents').map((row) => row.text)).toContain('事实永久保留');
  });

  test('paginates old terminal registrations without deleting paused intents', async () => {
    const db = new VacuumDb();
    const scheduler = new VacuumScheduler();
    const ctx = { db, scheduler } as unknown as MutationCtx;
    db.seed('activityRegistrations', registration('o:paused-intent', { state: 'intent' }));
    for (let index = 0; index < 65; index += 1) {
      const operationId = `o:terminal:${index}`;
      db.seed('activityRegistrations', registration(operationId));
      terminalFact(db, operationId);
    }

    await vacuumActivityRegistrationPage(ctx, {
      state: 'activated', before: now - ACTIVITY_REGISTRATION_RETENTION_MS, cursor: null,
    });
    expect(scheduler.calls).toHaveLength(1);
    expect(db.table('activityRegistrations')).toHaveLength(2);
    await vacuumActivityRegistrationPage(ctx, scheduler.calls[0].args as never);
    expect(db.table('activityRegistrations').map((row) => row.operationId))
      .toEqual(['o:paused-intent']);

    const schema = readFileSync('convex/schema.ts', 'utf8');
    expect(schema).toContain(".index('stateUpdatedAt', ['state', 'updatedAt'])");
    expect(readFileSync('convex/crons.ts', 'utf8'))
      .toContain('internal.crons.vacuumActivityRegistrations');
    expect(readFileSync('convex/crons.ts', 'utf8'))
      .toContain('export async function vacuumInputPage');
  });
});
