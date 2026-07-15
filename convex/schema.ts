import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { agentTables } from './agent/schema';
import { aiTownTables } from './aiTown/schema';
import { conversationId, playerId } from './aiTown/ids';
import { engineTables } from './engine/schema';

export default defineSchema({
  music: defineTable({
    storageId: v.string(),
    type: v.union(v.literal('background'), v.literal('player')),
  }),

  messages: defineTable({
    conversationId,
    messageUuid: v.string(),
    author: playerId,
    text: v.string(),
    worldId: v.optional(v.id('worlds')),
  })
    .index('conversationId', ['worldId', 'conversationId'])
    .index('messageUuid', ['conversationId', 'messageUuid']),

  townEvents: defineTable({
    worldId: v.id('worlds'),
    status: v.union(
      v.literal('scheduled'),
      v.literal('announced'),
      v.literal('running'),
      v.literal('completed'),
    ),
    phase: v.string(),
    seed: v.number(),
    phaseEndsAt: v.number(),
    winnerId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('worldId', ['worldId'])
    .index('status', ['status']),

  eventParticipants: defineTable({
    eventId: v.id('townEvents'),
    residentId: v.string(),
    displayName: v.string(),
    identity: v.string(),
    score: v.number(),
    shells: v.number(),
    active: v.boolean(),
    role: v.string(),
    rank: v.optional(v.number()),
    quote: v.optional(v.string()),
    decisionPhase: v.optional(v.string()),
  }).index('eventId', ['eventId']),

  eventLog: defineTable({
    eventId: v.id('townEvents'),
    eventKey: v.string(),
    sequence: v.number(),
    kind: v.string(),
    text: v.string(),
    createdAt: v.number(),
  })
    .index('eventId', ['eventId'])
    .index('eventKey', ['eventId', 'eventKey']),

  ...agentTables,
  ...aiTownTables,
  ...engineTables,
});
