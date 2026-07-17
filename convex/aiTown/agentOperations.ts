import { v } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { WorldMap, serializedWorldMap } from './worldMap';
import { rememberConversation } from '../agent/memory';
import { GameId, agentId, conversationId, playerId } from './ids';
import {
  continueConversationMessage,
  leaveConversationMessage,
  startConversationMessage,
} from '../agent/conversation';
import { assertNever } from '../util/assertNever';
import { serializedAgent } from './agent';
import {
  ACTIVITY_COOLDOWN,
  CONVERSATION_COOLDOWN,
  PLAYER_CONVERSATION_COOLDOWN,
} from '../constants';
import { api, internal } from '../_generated/api';
import { sleep } from '../util/sleep';
import { serializedPlayer } from './player';
import { pickResidentActivity } from '../../data/worlds/lighthouse-town/activities';
import { insertInput } from './insertInput';
import { distance } from '../util/geometry';
import { townLandmarkById } from '../../data/worlds/lighthouse-town/map';
import {
  ReplyContext,
  ReplyRejectionReason,
  validateResidentReply,
} from '../agent/conversationPolicy';

export async function generateValidatedResidentMessage(
  args: { kind: ReplyContext['kind'] },
  dependencies: {
    generate: () => Promise<string>;
    loadPolicyContext: () => Promise<Pick<ReplyContext, 'topic' | 'observerAskedAboutSea'>>;
    send: (validatedText: string) => Promise<unknown>;
    recordRejection: (reason: ReplyRejectionReason) => Promise<unknown>;
    reportGenerationUnavailable?: () => void;
    reportMetricUnavailable?: (reason: ReplyRejectionReason) => void;
  },
): Promise<void> {
  let raw = '';
  try {
    raw = await dependencies.generate();
  } catch {
    dependencies.reportGenerationUnavailable?.();
  }
  const policyContext = await dependencies.loadPolicyContext();
  const validation = validateResidentReply(raw, { kind: args.kind, ...policyContext });
  await dependencies.send(validation.text);
  if (!validation.accepted) {
    try {
      await dependencies.recordRejection(validation.reason);
    } catch {
      dependencies.reportMetricUnavailable?.(validation.reason);
    }
  }
}

export async function rememberConversationAndRelease(dependencies: {
  remember: () => Promise<unknown>;
  release: () => Promise<void>;
}): Promise<void> {
  try {
    await dependencies.remember();
  } finally {
    await dependencies.release();
  }
}

export async function runAgentOperation(ctx: MutationCtx, operation: string, args: any) {
  let reference;
  switch (operation) {
    case 'agentRememberConversation':
      reference = internal.aiTown.agentOperations.agentRememberConversation;
      break;
    case 'agentGenerateMessage':
      reference = internal.aiTown.agentOperations.agentGenerateMessage;
      break;
    case 'agentDoSomething':
      reference = internal.aiTown.agentOperations.agentDoSomething;
      break;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
  await ctx.scheduler.runAfter(0, reference, args);
}

export const agentSendMessage = internalMutation({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    agentId,
    playerId,
    validatedText: v.string(),
    messageUuid: v.string(),
    leaveConversation: v.boolean(),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author: args.playerId,
      text: args.validatedText,
      messageUuid: args.messageUuid,
      worldId: args.worldId,
    });
    await insertInput(ctx, args.worldId, 'agentFinishSendingMessage', {
      conversationId: args.conversationId,
      agentId: args.agentId,
      timestamp: Date.now(),
      leaveConversation: args.leaveConversation,
      operationId: args.operationId,
    });
  },
});

export const recordConversationPolicyEvent = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('conversationPolicyEvents', args);
  },
});

export const findConversationCandidate = internalQuery({
  args: {
    now: v.number(),
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
  },
  handler: async (ctx, { now, worldId, player, otherFreePlayers }) => {
    const { position } = player;
    const candidates = [];

    for (const otherPlayer of otherFreePlayers) {
      const lastMember = await ctx.db
        .query('participatedTogether')
        .withIndex('edge', (q) =>
          q.eq('worldId', worldId).eq('player1', player.id).eq('player2', otherPlayer.id),
        )
        .order('desc')
        .first();
      if (lastMember && now < lastMember.ended + PLAYER_CONVERSATION_COOLDOWN) {
        continue;
      }
      candidates.push({ id: otherPlayer.id, position: otherPlayer.position });
    }

    candidates.sort((a, b) => distance(a.position, position) - distance(b.position, position));
    return candidates[0]?.id;
  },
});

export const agentRememberConversation = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    await rememberConversationAndRelease({
      remember: () =>
        rememberConversation(
          ctx,
          args.worldId,
          args.agentId as GameId<'agents'>,
          args.playerId as GameId<'players'>,
          args.conversationId as GameId<'conversations'>,
        ),
      release: async () => {
        await sleep(Math.random() * 1000);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishRememberConversation',
          args: {
            agentId: args.agentId,
            operationId: args.operationId,
          },
        });
      },
    });
  },
});

export const agentGenerateMessage = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    otherPlayerId: playerId,
    operationId: v.string(),
    type: v.union(v.literal('start'), v.literal('continue'), v.literal('leave')),
    messageUuid: v.string(),
  },
  handler: async (ctx, args) => {
    let completionFn: typeof startConversationMessage;
    switch (args.type) {
      case 'start':
        completionFn = startConversationMessage;
        break;
      case 'continue':
        completionFn = continueConversationMessage;
        break;
      case 'leave':
        completionFn = leaveConversationMessage;
        break;
      default:
        assertNever(args.type);
    }
    await generateValidatedResidentMessage(
      { kind: args.type },
      {
        generate: () =>
          completionFn(
            ctx,
            args.worldId,
            args.conversationId as GameId<'conversations'>,
            args.playerId as GameId<'players'>,
            args.otherPlayerId as GameId<'players'>,
          ),
        loadPolicyContext: () =>
          ctx.runQuery(internal.agent.conversation.getConversationPolicyContext, {
            worldId: args.worldId,
            playerId: args.playerId,
            otherPlayerId: args.otherPlayerId,
            conversationId: args.conversationId,
          }),
        recordRejection: (reason) =>
          ctx.runMutation(internal.aiTown.agentOperations.recordConversationPolicyEvent, {
            worldId: args.worldId,
            playerId: args.playerId,
            conversationId: args.conversationId,
            reason,
            createdAt: Date.now(),
          }),
        send: (validatedText) =>
          ctx.runMutation(internal.aiTown.agentOperations.agentSendMessage, {
            worldId: args.worldId,
            conversationId: args.conversationId,
            agentId: args.agentId,
            playerId: args.playerId,
            validatedText,
            messageUuid: args.messageUuid,
            leaveConversation: args.type === 'leave',
            operationId: args.operationId,
          }),
        reportGenerationUnavailable: () => console.warn('resident-message-provider-unavailable'),
        reportMetricUnavailable: (reason) =>
          console.warn(`conversation-policy-metric-unavailable:${reason}`),
      },
    );
  },
});

export const agentDoSomething = internalAction({
  args: {
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    agent: v.object(serializedAgent),
    map: v.object(serializedWorldMap),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
    residentName: v.string(),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { player, agent } = args;
    const map = new WorldMap(args.map);
    const now = Date.now();
    // Don't try to start a new conversation if we were just in one.
    const justLeftConversation =
      agent.lastConversation && now < agent.lastConversation + CONVERSATION_COOLDOWN;
    // Don't try again if we recently tried to find someone to invite.
    const recentlyAttemptedInvite =
      agent.lastInviteAttempt && now < agent.lastInviteAttempt + CONVERSATION_COOLDOWN;
    const recentActivity = player.activity && now < player.activity.until + ACTIVITY_COOLDOWN;
    // Decide whether to do an activity or wander somewhere.
    if (!player.pathfinding) {
      if (recentActivity || justLeftConversation) {
        await sleep(Math.random() * 1000);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            destination: wanderDestination(map),
          },
        });
        return;
          } else {
            const activity = pickResidentActivity(args.residentName);
            const landmark = townLandmarkById(activity.landmarkId);
            const locatedActivity = `在${landmark.name}：${activity.description}`;
            await sleep(Math.random() * 1000);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
                agentId: agent.id,
                destination: landmark.destination,
                activity: {
                  description: locatedActivity,
                  emoji: activity.emoji,
                  until: Date.now() + activity.duration + 60_000,
            },
          },
        });
        await ctx.runMutation(internal.lives.recordActivity, {
          worldId: args.worldId,
              residentId: player.id,
              kind: activity.category,
              text: locatedActivity,
          createdAt: Date.now(),
        });
        return;
      }
    }
    const invitee =
      justLeftConversation || recentlyAttemptedInvite
        ? undefined
        : await ctx.runQuery(internal.aiTown.agentOperations.findConversationCandidate, {
            now,
            worldId: args.worldId,
            player: args.player,
            otherFreePlayers: args.otherFreePlayers,
          });

    // TODO: We hit a lot of OCC errors on sending inputs in this file. It's
    // easy for them to get scheduled at the same time and line up in time.
    await sleep(Math.random() * 1000);
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishDoSomething',
      args: {
        operationId: args.operationId,
        agentId: args.agent.id,
        invitee,
      },
    });
  },
});

function wanderDestination(worldMap: WorldMap) {
  // Wander someonewhere at least one tile away from the edge.
  return {
    x: 1 + Math.floor(Math.random() * (worldMap.width - 2)),
    y: 1 + Math.floor(Math.random() * (worldMap.height - 2)),
  };
}
