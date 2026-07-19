import { v } from 'convex/values';
import { internalMutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { playerId, type GameId } from './aiTown/ids';
import {
  getLifeProfileById,
  getLifeProfileByName,
  type LifeStats,
  type ResidentLifeProfile,
  residentLifeProfiles,
} from '../data/worlds/lighthouse-town/lives';
import { lighthouseCharacters } from '../data/worlds/lighthouse-town/characters';
import {
  institutions,
  residentEconomyProfiles,
} from '../data/worlds/lighthouse-town/economy';
import type { Id } from './_generated/dataModel';

type LiveSignals = {
  isTalking: boolean;
  isMoving: boolean;
  activity?: string;
  recentMessageCount: number;
};

const LIGHTHOUSE_ADULT_PROFILE_IDS = new Set(
  residentLifeProfiles.filter((profile) => profile.age >= 18).map((profile) => profile.id),
);

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function deriveLiveStats(baseStats: LifeStats, signals: LiveSignals) {
  const socialLift = Math.min(12, signals.recentMessageCount * 2) + (signals.isTalking ? 8 : 0);
  const moodLift = Math.min(8, signals.recentMessageCount) + (signals.isTalking ? 4 : 0);
  const isCommercial = !!signals.activity && /茶馆|账目|修理|工坊|送货|摆渡|看诊|卦馆|书院|灯笼|营业/.test(signals.activity);
  const isResting = !!signals.activity && /休息|睡|吃饭|用餐|喝茶/.test(signals.activity);
  const stats: LifeStats = {
    mood: clamp(baseStats.mood + moodLift),
    energy: clamp(baseStats.energy - (signals.isMoving ? 6 : 0) + (isResting ? 8 : 0)),
    health: clamp(baseStats.health + (isResting ? 3 : 0)),
    finance: clamp(baseStats.finance + (isCommercial ? 4 : 0)),
    reputation: clamp(baseStats.reputation + Math.min(3, signals.recentMessageCount)),
    social: clamp(baseStats.social + socialLift),
  };
  const situation = signals.isTalking
    ? '正在和邻居交谈'
    : signals.activity
      ? signals.activity
      : signals.isMoving
        ? '正在赶往下一处生活地点'
        : '正在按自己的节奏生活';
  return { stats, situation };
}

export type ActivityFact = {
  worldId: Id<'worlds'>;
  residentId: string;
  kind: string;
  text: string;
  createdAt: number;
  sourceKey?: string;
  operationId?: string;
  phase?: 'start' | 'complete' | 'failed';
  category?: string;
  landmarkId?: string;
  economicActionJson?: string;
  activityUntil?: number;
  failureReason?: string;
};

export async function recordActivityFact(ctx: Pick<MutationCtx, 'db'>, args: ActivityFact) {
  if (args.sourceKey) {
    const existing = await ctx.db
      .query('lifeEvents')
      .withIndex('sourceKey', (q) =>
        q.eq('worldId', args.worldId).eq('sourceKey', args.sourceKey),
      )
      .unique();
    if (existing) {
      const equivalent = Object.entries(args).every(
        ([key, value]) => existing[key as keyof typeof existing] === value,
      );
      if (equivalent) return existing._id;
      throw new Error(`life event source collision: ${args.sourceKey}`);
    }
    return ctx.db.insert('lifeEvents', args);
  }
  const latest = await ctx.db
    .query('lifeEvents')
    .withIndex('resident', (q) =>
      q.eq('worldId', args.worldId).eq('residentId', args.residentId),
    )
    .order('desc')
    .first();
  if (latest?.text === args.text && latest.createdAt > args.createdAt - 30_000) {
    return latest._id;
  }
  return ctx.db.insert('lifeEvents', args);
}

export const recordActivity = internalMutation({
  args: {
    worldId: v.id('worlds'),
    residentId: playerId,
    kind: v.string(),
    text: v.string(),
    createdAt: v.number(),
    sourceKey: v.optional(v.string()),
    operationId: v.optional(v.string()),
    phase: v.optional(v.union(
      v.literal('start'),
      v.literal('complete'),
      v.literal('failed'),
    )),
    category: v.optional(v.string()),
    landmarkId: v.optional(v.string()),
    economicActionJson: v.optional(v.string()),
    activityUntil: v.optional(v.number()),
    failureReason: v.optional(v.string()),
  },
  handler: recordActivityFact,
});

export const residentDossier = query({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: readResidentDossier,
});

export async function readResidentDossier(
  ctx: Pick<QueryCtx, 'db'>,
  args: { worldId: Id<'worlds'>; playerId: GameId<'players'> },
) {
    const world = await ctx.db.get(args.worldId);
    const worldStatus = await ctx.db
      .query('worldStatus')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .unique();
    if (!world || !worldStatus) return unavailableDossier('missing', 'world-missing');
    const worldRuntimeStatus = worldStatus.status === 'running' ? 'running' as const : 'paused' as const;
    const player = world.players.find((candidate) => candidate.id === args.playerId);
    const residentAgents = world.agents.filter((agent) => agent.playerId === args.playerId);
    if (!player || player.human || residentAgents.length !== 1) {
      return unavailableDossier(worldRuntimeStatus, 'resident-runtime-identity');
    }
    const description = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    const profile = description && resolveRuntimeProfile(description);
    if (!description || !profile) {
      return unavailableDossier(worldRuntimeStatus, 'resident-description-profile');
    }

    const conversation = world.conversations.find((candidate) => {
      const member = candidate.participants.find(
        (participant) => participant.playerId === args.playerId,
      );
      return member?.status.kind === 'participating';
    });
    const recentCutoff = Date.now() - 7 * 86_400_000;
    const messages = await ctx.db
      .query('messages')
      .withIndex('worldAuthor', (q) =>
        q.eq('worldId', args.worldId).eq('author', args.playerId),
      )
      .order('desc')
      .take(4);
    const authoredMessages = messages
      .filter((message) => message._creationTime >= recentCutoff);
    const lifeEvents = await ctx.db
      .query('lifeEvents')
      .withIndex('resident', (q) =>
        q.eq('worldId', args.worldId).eq('residentId', args.playerId),
      )
      .order('desc')
      .take(6);
    const economyAccount = await ctx.db
      .query('residentEconomy')
      .withIndex('resident', (q) =>
        q.eq('worldId', args.worldId).eq('residentId', args.playerId),
      )
      .unique();
    const economyProfile = residentEconomyProfiles.find(
      (candidate) => candidate.id === profile.id,
    );
    if (!economyProfile || (economyAccount && economyAccount.profileId !== economyProfile.id)) {
      return unavailableDossier(worldRuntimeStatus, 'resident-economy-profile');
    }
    const institution = economyProfile && institutions.find(
      (candidate) => candidate.id === economyProfile.institutionId,
    );
    const economyLedger = economyAccount
      ? await ctx.db
          .query('economyLedger')
          .withIndex('residentTime', (q) =>
            q.eq('worldId', args.worldId).eq('residentId', args.playerId),
          )
          .order('desc')
          .take(5)
      : [];
    const [relationshipsAsA, relationshipsAsB] = await Promise.all([
      ctx.db
        .query('townRelationships')
        .withIndex('worldResidentA', (q) =>
          q.eq('worldId', args.worldId).eq('residentA', args.playerId),
        )
        .take(9),
      ctx.db
        .query('townRelationships')
        .withIndex('worldResidentB', (q) =>
          q.eq('worldId', args.worldId).eq('residentB', args.playerId),
        )
        .take(9),
    ]);
    const runtimeRelationships = [] as Array<{
      targetId: GameId<'players'>;
      targetName: string;
      targetPhoto: string;
      friendship: number;
      trust: number;
      attraction: number;
      business: number;
      recentChanges: Array<{
        kind: string;
        text: string;
        sourceKey: string;
        createdAt: number;
        friendshipDelta: number;
        trustDelta: number;
        attractionDelta: number;
        businessDelta: number;
      }>;
    }>;
    const seenTargets = new Set<string>();
    const seenProfileIds = new Set<string>([profile.id]);
    let invalidRelationshipRow = false;
    for (const relationship of [...relationshipsAsA, ...relationshipsAsB]) {
        if (
          relationship.residentA >= relationship.residentB
          || (relationship.residentA !== args.playerId && relationship.residentB !== args.playerId)
        ) {
          invalidRelationshipRow = true;
          continue;
        }
        const targetId = (relationship.residentA === args.playerId
          ? relationship.residentB
          : relationship.residentA) as GameId<'players'>;
        if (seenTargets.has(targetId)) {
          invalidRelationshipRow = true;
          continue;
        }
        const targetPlayer = world.players.find((candidate) => candidate.id === targetId);
        const targetAgents = world.agents.filter((agent) => agent.playerId === targetId);
        const targetDescription = await ctx.db
          .query('playerDescriptions')
          .withIndex('worldId', (q) =>
            q.eq('worldId', args.worldId).eq('playerId', targetId),
          )
          .first();
        const targetProfile = targetDescription && resolveRuntimeProfile(targetDescription);
        if (
          !targetPlayer
          || targetPlayer.human
          || targetAgents.length !== 1
          || !targetProfile
          || seenProfileIds.has(targetProfile.id)
        ) {
          invalidRelationshipRow = true;
          continue;
        }
        seenTargets.add(targetId);
        seenProfileIds.add(targetProfile.id);
        const recentChanges = await ctx.db
          .query('relationshipChanges')
          .withIndex('pairTime', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('residentA', relationship.residentA)
              .eq('residentB', relationship.residentB),
          )
          .order('desc')
          .take(3);
        runtimeRelationships.push({
          targetId,
          targetName: targetProfile.name,
          targetPhoto: targetProfile.photos[0],
          friendship: relationship.friendship,
          trust: relationship.trust,
          attraction: relationship.attraction,
          business: relationship.business,
          recentChanges: recentChanges.map((change) => ({
            kind: change.kind,
            text: change.text,
            sourceKey: change.sourceKey,
            createdAt: change.createdAt,
            friendshipDelta: change.friendshipDelta,
            trustDelta: change.trustDelta,
            attractionDelta: change.attractionDelta,
            businessDelta: change.businessDelta,
          })),
        });
    }
    const activity = player?.activity && player.activity.until > Date.now()
      ? player.activity.description
      : undefined;
    const { stats, situation } = deriveLiveStats(profile.baseStats, {
      isTalking: !!conversation,
      isMoving: !!player?.pathfinding,
      activity,
      recentMessageCount: authoredMessages.length,
    });

    const recordedEvents = [
      ...lifeEvents.map((event) => ({
        kind: event.kind,
        text: event.text,
        createdAt: event.createdAt as number | null,
      })),
      ...authoredMessages.map((message) => ({
        kind: 'conversation',
        text: `谈到：${cleanExcerpt(message.text)}`,
        createdAt: message._creationTime as number | null,
      })),
    ]
      .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
      .slice(0, 4);
    const recentEvents = [
      {
        kind: conversation ? 'social' : player?.pathfinding ? 'movement' : 'life',
        text: situation,
        createdAt: null as number | null,
      },
      ...recordedEvents,
      ...profile.recentHighlights.map((text) => ({
        kind: 'memory',
        text,
        createdAt: null as number | null,
      })),
    ].slice(0, 6);
    const completeAdultProfileSet = seenProfileIds.size === LIGHTHOUSE_ADULT_PROFILE_IDS.size
      && [...LIGHTHOUSE_ADULT_PROFILE_IDS].every((profileId) => seenProfileIds.has(profileId));
    const completeRelationships = runtimeRelationships.length === LIGHTHOUSE_ADULT_PROFILE_IDS.size - 1
      && completeAdultProfileSet
      && !invalidRelationshipRow;

    return {
      dossierStatus: 'available' as const,
      worldRuntimeStatus,
      snapshotStatus: worldRuntimeStatus === 'running' ? 'current' as const : 'paused' as const,
      profile: {
        id: profile.id,
        name: profile.name,
        age: profile.age,
        occupation: profile.occupation,
        home: profile.home,
        personality: profile.personality,
        outfit: profile.outfit,
        diet: profile.diet,
        business: profile.business,
        currentGoal: profile.currentGoal,
        photos: profile.photos,
      },
      stats,
      situation,
      recentEvents,
      economy: economyAccount
        ? {
            economyStatus: worldRuntimeStatus === 'running' ? 'live' as const : 'snapshot' as const,
            staticFallback: false,
            balance: economyAccount.balance,
            todayIncome: economyAccount.todayIncome,
            todayExpense: economyAccount.todayExpense,
            hunger: economyAccount.hunger,
            energy: economyAccount.energy,
            dayKey: economyAccount.dayKey,
            occupation: economyProfile?.occupation ?? profile.occupation,
            institution: institution?.name ?? null,
            compensation: economyProfile?.compensation ?? null,
            recentLedger: economyLedger.map((entry) => ({
              kind: entry.kind,
              text: entry.text,
              amount: entry.amount,
              item: entry.item,
              quantity: entry.quantity,
              createdAt: entry.createdAt,
              sourceKey: entry.sourceKey,
            })),
          }
        : {
            economyStatus: 'initializing' as const,
            staticFallback: true,
            balance: null,
            todayIncome: null,
            todayExpense: null,
            hunger: null,
            energy: null,
            dayKey: null,
            occupation: economyProfile?.occupation ?? profile.occupation,
            institution: institution?.name ?? null,
            compensation: economyProfile?.compensation ?? null,
            recentLedger: [],
          },
      relationshipsStatus: worldRuntimeStatus === 'paused' && completeRelationships
        ? 'snapshot' as const
        : completeRelationships
          ? 'live' as const
          : runtimeRelationships.length > 0
            ? 'partial' as const
            : 'initializing' as const,
      relationshipCount: runtimeRelationships.length,
      expectedRelationshipCount: LIGHTHOUSE_ADULT_PROFILE_IDS.size - 1,
      relationships: runtimeRelationships,
    };
}

function resolveRuntimeProfile(description: { name: string; character?: string }) {
  const nameProfile = getLifeProfileByName(description.name);
  if (description.character) {
    const characterProfile = getLifeProfileById(lighthouseCharacters.find(
      (character) => character.sprite === description.character,
    )?.id ?? '');
    if (!nameProfile || !characterProfile || nameProfile.id !== characterProfile.id) return null;
  }
  return nameProfile && isConfiguredAdultProfile(nameProfile) ? nameProfile : null;
}

function isConfiguredAdultProfile(profile: ResidentLifeProfile) {
  return profile.age >= 18 && LIGHTHOUSE_ADULT_PROFILE_IDS.has(profile.id);
}

function unavailableDossier(
  worldRuntimeStatus: 'running' | 'paused' | 'missing',
  unavailableReason: string,
) {
  return {
    dossierStatus: 'unavailable' as const,
    worldRuntimeStatus,
    snapshotStatus: 'unavailable' as const,
    unavailableReason,
  };
}

function cleanExcerpt(text: string) {
  const cleaned = text
    .replace(/（[^）]*）/g, ' ')
    .replace(/[“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${cleaned.slice(0, 52)}${cleaned.length > 52 ? '…' : ''}`;
}
