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
    dailyKey: v.optional(v.string()),
    templateId: v.optional(v.string()),
    eventName: v.optional(v.string()),
    announcement: v.optional(v.string()),
    venueMode: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    archiveReason: v.optional(v.string()),
    stageIndex: v.optional(v.number()),
    themeSource: v.optional(v.string()),
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
    .index('worldDay', ['worldId', 'dailyKey'])
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
    teamId: v.optional(v.string()),
    choiceId: v.optional(v.string()),
    decisionStage: v.optional(v.number()),
    reachedFinal: v.optional(v.boolean()),
    participationRewarded: v.optional(v.boolean()),
    finalistRewarded: v.optional(v.boolean()),
    championRewarded: v.optional(v.boolean()),
  }).index('eventId', ['eventId']),

  eventLog: defineTable({
    eventId: v.id('townEvents'),
    eventKey: v.string(),
    sequence: v.number(),
    kind: v.string(),
    text: v.string(),
    createdAt: v.number(),
    stageIndex: v.optional(v.number()),
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
    economicActionJson: v.optional(v.string()),
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

  dailyEconomyDays: defineTable({
    worldId: v.id('worlds'),
    dayKey: v.string(),
    advancedAt: v.number(),
  })
    .index('worldDay', ['worldId', 'dayKey']),

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
    .index('day', ['worldId', 'dayKey', 'createdAt'])
    .index('residentTime', ['worldId', 'residentId', 'createdAt'])
    .index('institutionTime', ['worldId', 'institutionId', 'createdAt']),

  townRelationships: defineTable({
    worldId: v.id('worlds'),
    residentA: playerId,
    residentB: playerId,
    friendship: v.number(),
    trust: v.number(),
    attraction: v.number(),
    business: v.number(),
    initialFriendship: v.optional(v.number()),
    initialTrust: v.optional(v.number()),
    initialAttraction: v.optional(v.number()),
    initialBusiness: v.optional(v.number()),
    initializationSourceKey: v.optional(v.string()),
    initializedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('pair', ['worldId', 'residentA', 'residentB'])
    .index('worldResidentA', ['worldId', 'residentA'])
    .index('worldResidentB', ['worldId', 'residentB'])
    .index('world', ['worldId']),

  // Append-only structured facts. The matching relationship update happens in
  // the same Convex mutation, so either both writes commit or neither does.
  relationshipChanges: defineTable({
    worldId: v.id('worlds'),
    idempotencyKey: v.string(),
    residentA: playerId,
    residentB: playerId,
    kind: v.union(
      v.literal('conversation'),
      v.literal('cooperation'),
      v.literal('trade'),
      v.literal('care'),
      v.literal('reciprocal-affection'),
      v.literal('dispute'),
    ),
    reciprocal: v.optional(v.boolean()),
    friendshipDelta: v.number(),
    trustDelta: v.number(),
    attractionDelta: v.number(),
    businessDelta: v.number(),
    dayKey: v.string(),
    sourceKey: v.string(),
    text: v.string(),
    createdAt: v.number(),
  })
    .index('idempotencyKey', ['worldId', 'idempotencyKey'])
    .index('pairDay', ['worldId', 'residentA', 'residentB', 'dayKey'])
    .index('pairTime', ['worldId', 'residentA', 'residentB', 'createdAt'])
    .index('worldDay', ['worldId', 'dayKey', 'createdAt']),

  ...agentTables,
  ...aiTownTables,
  ...engineTables,
});
