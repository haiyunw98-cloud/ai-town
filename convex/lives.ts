import { v } from 'convex/values';
import { internalMutation, query, type MutationCtx } from './_generated/server';
import { playerId } from './aiTown/ids';
import {
  getLifeProfileById,
  getLifeProfileByName,
  type LifeStats,
} from '../data/worlds/lighthouse-town/lives';
import { lighthouseCharacters } from '../data/worlds/lighthouse-town/characters';
import type { Id } from './_generated/dataModel';

type LiveSignals = {
  isTalking: boolean;
  isMoving: boolean;
  activity?: string;
  recentMessageCount: number;
};

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
  handler: async (ctx, args) => {
    const description = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    const characterId = description && lighthouseCharacters.find(
      (character) => character.sprite === description.character,
    )?.id;
    const profile = characterId
      ? getLifeProfileById(characterId)
      : description && getLifeProfileByName(description.name);
    if (!description || !profile) return null;

    const world = await ctx.db.get(args.worldId);
    const player = world?.players.find((candidate) => candidate.id === args.playerId);
    const conversation = world?.conversations.find((candidate) => {
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

    return {
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
      relationships: profile.relationships.flatMap((relationship) => {
        const target = getLifeProfileById(relationship.targetId);
        return target
          ? [{
              ...relationship,
              targetName: target.name,
              targetPhoto: target.photos[0],
            }]
          : [];
      }),
    };
  },
});

function cleanExcerpt(text: string) {
  const cleaned = text
    .replace(/（[^）]*）/g, ' ')
    .replace(/[“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${cleaned.slice(0, 52)}${cleaned.length > 52 ? '…' : ''}`;
}
