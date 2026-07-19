import { v } from 'convex/values';
import { internal } from './_generated/api';
import { DatabaseReader, internalMutation, MutationCtx, mutation } from './_generated/server';
import { localizedDescriptions } from '../data/worlds/lighthouse-town/characters';
import * as map from '../data/worlds/lighthouse-town/map';
import { insertInput } from './aiTown/insertInput';
import { Id } from './_generated/dataModel';
import { createEngine } from './aiTown/main';
import { ENGINE_ACTION_DURATION } from './constants';
import { detectMismatchedLLMProvider } from './util/llm';
import { getWorldLocale } from './util/worldLocale';
import { initializeTownEconomy, reconcileTownEconomyAfterAgentCreation } from './townEconomy';
import { initializeTownRelations, reconcileTownRelationsAfterAgentCreation } from './townRelations';

const Descriptions = localizedDescriptions(getWorldLocale());
type ConfiguredResidentDescription = (typeof Descriptions)[number];

const MAX_CONFIGURED_RESIDENTS = 32;

export async function reconcileConfiguredResidentDescriptions(
  ctx: Pick<MutationCtx, 'db'>,
  worldId: Id<'worlds'>,
  descriptions: readonly ConfiguredResidentDescription[] = Descriptions,
) {
  if (descriptions.length > MAX_CONFIGURED_RESIDENTS) {
    throw new Error(`Too many configured residents: ${descriptions.length}`);
  }
  const byName = new Map<string, ConfiguredResidentDescription>();
  const byCharacter = new Map<string, ConfiguredResidentDescription>();
  const byIdentity = new Map<string, ConfiguredResidentDescription>();
  for (const description of descriptions) {
    if (byName.has(description.name)) {
      throw new Error(`Duplicate configured resident name: ${description.name}`);
    }
    byName.set(description.name, description);
    byCharacter.set(description.character, description);
    byIdentity.set(description.identity, description);
  }

  const world = await ctx.db.get(worldId);
  if (!world) throw new Error(`Invalid world ID: ${worldId}`);

  const playerPatches: Array<{
    id: Id<'playerDescriptions'>;
    value: { name: string; character: string; description: string };
  }> = [];
  const agentPatches: Array<{
    id: Id<'agentDescriptions'>;
    value: { identity: string; plan: string };
  }> = [];
  const matchedNames = new Set<string>();

  for (const player of world.players) {
    const playerDescriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId).eq('playerId', player.id))
      .take(2);
    const configuredRows = playerDescriptions.filter((row) => byName.has(row.name));
    if (configuredRows.length === 0) continue;
    if (playerDescriptions.length !== 1) {
      throw new Error(`Duplicate player description mapping for ${player.id}`);
    }

    const playerDescription = configuredRows[0];
    const configured = byName.get(playerDescription.name)!;
    if (matchedNames.has(configured.name)) {
      throw new Error(`Duplicate persisted resident name: ${configured.name}`);
    }
    matchedNames.add(configured.name);
    if (player.human !== undefined) {
      throw new Error(`Configured resident ${configured.name} belongs to a human player`);
    }
    const characterOwner = byCharacter.get(playerDescription.character);
    if (characterOwner && characterOwner.name !== configured.name) {
      throw new Error(
        `Character/profile conflict for ${configured.name}: ${playerDescription.character}`,
      );
    }
    const playerIdentityOwner = byIdentity.get(playerDescription.description);
    if (playerIdentityOwner && playerIdentityOwner.name !== configured.name) {
      throw new Error(`Profile identity conflict for ${configured.name}`);
    }

    const agents = world.agents.filter((agent) => agent.playerId === player.id);
    if (agents.length !== 1) {
      throw new Error(`Invalid agent mapping for configured resident ${configured.name}`);
    }
    const agent = agents[0];
    const agentDescriptions = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId).eq('agentId', agent.id))
      .take(2);
    if (agentDescriptions.length !== 1) {
      throw new Error(
        `Invalid agent description mapping for configured resident ${configured.name}`,
      );
    }
    const agentDescription = agentDescriptions[0];
    const agentIdentityOwner = byIdentity.get(agentDescription.identity);
    if (agentIdentityOwner && agentIdentityOwner.name !== configured.name) {
      throw new Error(`Agent identity conflict for ${configured.name}`);
    }

    const desiredPlayer = {
      name: configured.name,
      character: configured.character,
      description: configured.identity,
    };
    if (
      playerDescription.name !== desiredPlayer.name ||
      playerDescription.character !== desiredPlayer.character ||
      playerDescription.description !== desiredPlayer.description
    ) {
      playerPatches.push({ id: playerDescription._id, value: desiredPlayer });
    }
    const desiredAgent = { identity: configured.identity, plan: configured.plan };
    if (
      agentDescription.identity !== desiredAgent.identity ||
      agentDescription.plan !== desiredAgent.plan
    ) {
      agentPatches.push({ id: agentDescription._id, value: desiredAgent });
    }
  }

  for (const patch of playerPatches) await ctx.db.patch(patch.id, patch.value);
  for (const patch of agentPatches) await ctx.db.patch(patch.id, patch.value);
  return { playerUpdates: playerPatches.length, agentUpdates: agentPatches.length };
}

const init = mutation({
  args: {
    numAgents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    detectMismatchedLLMProvider();
    const { worldStatus, engine } = await getOrCreateDefaultWorld(ctx);
    await reconcileConfiguredResidentDescriptions(ctx, worldStatus.worldId);
    if (worldStatus.status !== 'running') {
      console.warn(
        `Engine ${engine._id} is not active! Run "npx convex run testing:resume" to restart it.`,
      );
      return;
    }
    const requestedDescriptions = Descriptions.slice(
      0,
      args.numAgents !== undefined ? args.numAgents : Descriptions.length,
    );
    const missingDescriptionIndexes = await findMissingDescriptionIndexes(
      ctx.db,
      worldStatus.worldId,
      worldStatus.engineId,
      requestedDescriptions,
    );
    if (missingDescriptionIndexes.length > 0) {
      for (const descriptionIndex of missingDescriptionIndexes) {
        await insertInput(ctx, worldStatus.worldId, 'createAgent', { descriptionIndex });
      }
      await ctx.scheduler.runAfter(15_000, internal.events.advanceActiveEvents, {});
    }
    const economy = await initializeTownEconomy(ctx, worldStatus.worldId);
    const relations = await initializeTownRelations(ctx, worldStatus.worldId);
    if (
      economy.residentCount < Descriptions.length &&
      economy.conflictingResidentNames.length === 0
    ) {
      await ctx.scheduler.runAfter(20_000, internal.init.reconcileTownEconomy, {
        worldId: worldStatus.worldId,
        attempt: 0,
      });
    }
    if (
      relations.residentCount < Descriptions.length &&
      relations.conflictingResidentNames.length === 0
    ) {
      await ctx.scheduler.runAfter(20_000, internal.init.reconcileTownRelations, {
        worldId: worldStatus.worldId,
        attempt: 0,
      });
    }
    return {
      worldId: worldStatus.worldId,
      queuedResidents: missingDescriptionIndexes.map((index) => Descriptions[index].name),
      economy,
      relations,
    };
  },
});
export default init;

// Agent creation is asynchronous. This second idempotent reconciliation fills accounts
// only after their runtime player IDs and descriptions exist.
export const reconcileTownEconomy = internalMutation({
  args: { worldId: v.id('worlds'), attempt: v.number() },
  handler: async (ctx, args) => reconcileTownEconomyAfterAgentCreation(ctx, args),
});

export const reconcileTownRelations = internalMutation({
  args: { worldId: v.id('worlds'), attempt: v.number() },
  handler: async (ctx, args) => reconcileTownRelationsAfterAgentCreation(ctx, args),
});

async function getOrCreateDefaultWorld(ctx: MutationCtx) {
  const now = Date.now();

  let worldStatus = await ctx.db
    .query('worldStatus')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .unique();
  if (worldStatus) {
    const engine = (await ctx.db.get(worldStatus.engineId))!;
    return { worldStatus, engine };
  }

  const engineId = await createEngine(ctx);
  const engine = (await ctx.db.get(engineId))!;
  const worldId = await ctx.db.insert('worlds', {
    nextId: 0,
    agents: [],
    conversations: [],
    players: [],
  });
  const worldStatusId = await ctx.db.insert('worldStatus', {
    engineId: engineId,
    isDefault: true,
    lastViewed: now,
    status: 'running',
    worldId: worldId,
  });
  worldStatus = (await ctx.db.get(worldStatusId))!;
  await ctx.db.insert('maps', {
    worldId,
    width: map.mapwidth,
    height: map.mapheight,
    tileSetUrl: map.tilesetpath,
    tileSetDimX: map.tilesetpxw,
    tileSetDimY: map.tilesetpxh,
    tileDim: map.tiledim,
    bgTiles: map.bgtiles,
    objectTiles: map.objmap,
    animatedSprites: map.animatedsprites,
  });
  await ctx.scheduler.runAfter(0, internal.aiTown.main.runStep, {
    worldId,
    generationNumber: engine.generationNumber,
    maxDuration: ENGINE_ACTION_DURATION,
  });
  return { worldStatus, engine };
}

async function findMissingDescriptionIndexes(
  db: DatabaseReader,
  worldId: Id<'worlds'>,
  engineId: Id<'engines'>,
  requestedDescriptions: typeof Descriptions,
) {
  const world = await db.get(worldId);
  if (!world) {
    throw new Error(`Invalid world ID: ${worldId}`);
  }
  const existingDescriptions = await db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .collect();
  const existingNames = new Set(existingDescriptions.map((description) => description.name));
  const unactionedJoinInputs = await db
    .query('inputs')
    .withIndex('byInputNumber', (q) => q.eq('engineId', engineId))
    .order('asc')
    .filter((q) => q.eq(q.field('name'), 'createAgent'))
    .filter((q) => q.eq(q.field('returnValue'), undefined))
    .collect();
  const pendingIndexes = new Set(
    unactionedJoinInputs
      .map((input) => (input.args as { descriptionIndex?: unknown }).descriptionIndex)
      .filter((index): index is number => typeof index === 'number'),
  );
  return requestedDescriptions.flatMap((description, index) =>
    existingNames.has(description.name) || pendingIndexes.has(index) ? [] : [index],
  );
}
