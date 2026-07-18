import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { agentTables } from './agent/schema';
import { aiTownTables } from './aiTown/schema';
import { agentId, conversationId, playerId } from './aiTown/ids';
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
    .index('worldId', ['worldId'])
    .index('worldAuthor', ['worldId', 'author'])
    .index('conversationId', ['worldId', 'conversationId'])
    .index('messageUuid', ['conversationId', 'messageUuid']),

  conversationTopics: defineTable({
    worldId: v.id('worlds'),
    playerId,
    conversationId,
    category: v.union(
      v.literal('livelihood'),
      v.literal('relationship'),
      v.literal('public-life'),
    ),
    detail: v.string(),
    dayKey: v.string(),
    selectedAt: v.number(),
  })
    .index('conversation', ['worldId', 'conversationId', 'playerId'])
    .index('residentDay', ['worldId', 'playerId', 'dayKey', 'selectedAt'])
    .index('residentTime', ['worldId', 'playerId', 'selectedAt']),

  conversationPolicyEvents: defineTable({
    worldId: v.id('worlds'),
    playerId,
    conversationId,
    reason: v.union(
      v.literal('world-correction'),
      v.literal('empty'),
      v.literal('legacy-story'),
      v.literal('too-long'),
    ),
    createdAt: v.number(),
  })
    .index('worldTime', ['worldId', 'createdAt'])
    .index('playerTime', ['playerId', 'createdAt']),

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

  lifeEvents: defineTable({
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
  })
    .index('resident', ['worldId', 'residentId', 'createdAt'])
    .index('sourceKey', ['worldId', 'sourceKey'])
    .index('worldTime', ['worldId', 'createdAt']),

  activityRegistrations: defineTable({
    worldId: v.id('worlds'),
    residentId: playerId,
    agentId,
    operationId: v.string(),
    activityText: v.string(),
    activityDuration: v.number(),
    activityUntil: v.optional(v.number()),
    activatedAt: v.optional(v.number()),
    inputId: v.optional(v.id('inputs')),
    landmarkId: v.string(),
    category: v.string(),
    economicActionJson: v.string(),
    startedAt: v.number(),
    state: v.union(v.literal('intent'), v.literal('activated'), v.literal('abandoned')),
    deliveryState: v.union(
      v.literal('queued'),
      v.literal('processing'),
      v.literal('processed'),
      v.literal('failed'),
    ),
    abandonReason: v.optional(v.union(
      v.literal('operation-replaced'),
      v.literal('engine-input-error'),
      v.literal('ack-processing-failed'),
    )),
    recoveryAttempts: v.number(),
    settlementArrivalGraceStartedAt: v.optional(v.number()),
    settlementArrivalRecoveryDeadline: v.optional(v.number()),
    settlementLastAttemptAt: v.optional(v.number()),
    settlementPauseRetryCount: v.optional(v.number()),
    settlementWakeScheduledAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('operation', ['worldId', 'operationId'])
    .index('inputId', ['inputId'])
    .index('worldState', ['worldId', 'state', 'updatedAt'])
    .index('stateUpdatedAt', ['state', 'updatedAt']),

  activityRegistrationAcks: defineTable({
    worldId: v.id('worlds'),
    inputId: v.id('inputs'),
    registrationId: v.id('activityRegistrations'),
    ackKind: v.union(
      v.literal('activated'),
      v.literal('rejected'),
      v.literal('engine-error'),
      v.literal('invalid-ack'),
    ),
    payloadJson: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('retrying'),
      v.literal('processed'),
      v.literal('dead-letter'),
    ),
    attempts: v.number(),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('input', ['worldId', 'inputId'])
    .index('statusUpdatedAt', ['status', 'updatedAt']),

  residentEconomy: defineTable({
    worldId: v.id('worlds'),
    residentId: playerId,
    profileId: v.string(),
    balance: v.number(),
    initialBalance: v.optional(v.number()),
    hunger: v.number(),
    energy: v.number(),
    todayIncome: v.number(),
    todayExpense: v.number(),
    dayKey: v.string(),
    initializationSourceKey: v.optional(v.string()),
    initializedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('resident', ['worldId', 'residentId'])
    .index('profile', ['worldId', 'profileId'])
    .index('world', ['worldId']),

  townInstitutions: defineTable({
    worldId: v.id('worlds'),
    institutionId: v.string(),
    cash: v.number(),
    initialCash: v.optional(v.number()),
    stockJson: v.string(),
    initialStockJson: v.optional(v.string()),
    serviceCountersJson: v.string(),
    initialServiceCountersJson: v.optional(v.string()),
    todayIncome: v.number(),
    todayExpense: v.number(),
    visitorCount: v.number(),
    dayKey: v.string(),
    initializationSourceKey: v.optional(v.string()),
    initializedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('institution', ['worldId', 'institutionId'])
    .index('world', ['worldId']),

  // Append-only factual journal. Code writes through appendEconomyLedger, whose
  // stable idempotency key preserves the first observed settlement.
  economyLedger: defineTable({
    worldId: v.id('worlds'),
    idempotencyKey: v.string(),
    dayKey: v.string(),
    residentId: v.optional(playerId),
    institutionId: v.optional(v.string()),
    kind: v.union(
      v.literal('work'),
      v.literal('purchase'),
      v.literal('restock'),
      v.literal('event-reward'),
      v.literal('event-service'),
    ),
    amount: v.number(),
    expectedAmount: v.optional(v.number()),
    compensationKind: v.optional(v.union(
      v.literal('wage'),
      v.literal('owner-draw'),
      v.literal('contract-share'),
    )),
    item: v.optional(v.string()),
    quantity: v.optional(v.number()),
    sourceKey: v.string(),
    text: v.string(),
    createdAt: v.number(),
  })
    .index('idempotencyKey', ['worldId', 'idempotencyKey'])
    .index('day', ['worldId', 'dayKey', 'createdAt']),

  ...agentTables,
  ...aiTownTables,
  ...engineTables,
});
