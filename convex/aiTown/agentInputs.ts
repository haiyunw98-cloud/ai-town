import { v } from 'convex/values';
import { agentId, conversationId, parseGameId, playerId, type GameId } from './ids';
import { Player, activity } from './player';
import { Conversation, conversationInputs } from './conversation';
import { blocked, movePlayer } from './movement';
import { inputHandler } from './inputHandler';
import { point } from '../util/types';
import { localizedDescriptions } from '../../data/worlds/lighthouse-town/characters';
import { getWorldLocale } from '../util/worldLocale';
import { AgentDescription } from './agentDescription';
import { Agent } from './agent';
import {
  eventCheckpoints,
  trialIslandCheckpoints,
} from '../../data/worlds/lighthouse-town/map';
import { segmentConversationGraphemes } from '../util/conversationText';

const Descriptions = localizedDescriptions(getWorldLocale());
const MAX_EVENT_TRANSFER_DURATION = 2 * 60 * 60_000;
const MAX_OBSERVER_COMMAND_DURATION = 24 * 60 * 60_000;
export const MAX_EVENT_TRANSFER_STALENESS = 2 * 60 * 60_000;
const EVENT_TRANSFER_DESTINATIONS = [
  ...Object.values(trialIslandCheckpoints),
];
const EVENT_TRANSFER_DOCK_RADIUS = 4;
const EVENT_TRANSFER_ISLAND_RADIUS = 3;

export function prepareEventTransfer(
  game: Pick<import('./game').Game, 'worldMap'>,
  now: number,
  args: { destination: { x: number; y: number }; description: string; until: number },
) {
  const { x, y } = args.destination;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('Event transfer destination must be finite.');
  }
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error('Event transfer destination must use integer coordinates.');
  }
  if (x < 0 || y < 0 || x >= game.worldMap.width || y >= game.worldMap.height) {
    throw new Error('Event transfer destination is outside map bounds.');
  }
  const isIslandCheckpoint = EVENT_TRANSFER_DESTINATIONS.some(
    (entry) =>
      Math.abs(entry.x - x) <= EVENT_TRANSFER_ISLAND_RADIUS
      && Math.abs(entry.y - y) <= EVENT_TRANSFER_ISLAND_RADIUS,
  );
  const isMainTownDockBerth =
    Math.abs(x - eventCheckpoints.dock.x) <= EVENT_TRANSFER_DOCK_RADIUS
    && Math.abs(y - eventCheckpoints.dock.y) <= EVENT_TRANSFER_DOCK_RADIUS;
  if (!isIslandCheckpoint && !isMainTownDockBerth) {
    throw new Error('Event transfer destination is not an allowlisted ferry checkpoint.');
  }
  if (game.worldMap.objectTiles.some((layer) => layer[x]?.[y] !== -1)) {
    throw new Error('Event transfer destination must be walkable.');
  }
  if (
    !Number.isFinite(args.until)
    || args.until < now - MAX_EVENT_TRANSFER_STALENESS
    || args.until > now + MAX_EVENT_TRANSFER_DURATION
  ) {
    throw new Error('Event transfer activity expiry is outside the allowed time window.');
  }
  const trimmed = args.description.trim();
  if (!trimmed) throw new Error('Event transfer description must not be empty.');
  return {
    destination: { x, y },
    description: segmentConversationGraphemes(trimmed).slice(0, 80).join(''),
    until: Math.max(now, args.until),
  };
}

function cancelResidentOperation(
  game: Pick<import('./game').Game, 'world'>,
  residentId: string,
) {
  for (const agent of game.world.agents.values()) {
    if (agent.playerId === residentId) {
      delete agent.inProgressOperation;
      return;
    }
  }
}

function stopResidentConversation(
  game: Pick<import('./game').Game, 'world'>,
  now: number,
  residentId: GameId<'players'>,
) {
  const conversation = [...game.world.conversations.values()].find((candidate) =>
    candidate.participants.has(residentId),
  );
  conversation?.stop(game as import('./game').Game, now);
}

export function findNearbyOpenDestination(
  game: Pick<import('./game').Game, 'world' | 'worldMap'>,
  now: number,
  player: Player,
  requested: { x: number; y: number },
) {
  const reserved = new Set(
    [...game.world.players.values()]
      .filter((candidate) => candidate.id !== player.id)
      .flatMap((candidate) => candidate.pathfinding
        ? [`${candidate.pathfinding.destination.x}:${candidate.pathfinding.destination.y}`]
        : []),
  );
  const seed = [...String(player.id)].reduce((sum, value) => sum + value.charCodeAt(0), 0);
  for (let radius = 0; radius <= 3; radius += 1) {
    const ring: Array<{ x: number; y: number }> = [];
    for (let dx = -radius; dx <= radius; dx += 1) {
      const dy = radius - Math.abs(dx);
      ring.push({ x: requested.x + dx, y: requested.y + dy });
      if (dy !== 0) ring.push({ x: requested.x + dx, y: requested.y - dy });
    }
    for (let offset = 0; offset < ring.length; offset += 1) {
      const candidate = ring[(offset + seed) % ring.length];
      if (reserved.has(`${candidate.x}:${candidate.y}`)) continue;
      if (blocked(game as import('./game').Game, now, candidate, player.id) === null) {
        return candidate;
      }
    }
  }
  return requested;
}

export const agentInputs = {
  observerCommand: inputHandler({
    args: {
      playerId,
      destination: point,
      description: v.string(),
      emoji: v.string(),
      until: v.number(),
    },
    handler: (game, now, args) => {
      const player = game.world.players.get(parseGameId('players', args.playerId));
      if (!player) throw new Error(`Observer command AI resident not found: ${args.playerId}`);
      if (player.human) throw new Error('Observer commands are restricted to AI residents.');
      if (
        !Number.isSafeInteger(args.until)
        || args.until <= now
        || args.until > now + MAX_OBSERVER_COMMAND_DURATION
      ) {
        throw new Error('Observer command duration is outside the allowed time window.');
      }
      const description = segmentConversationGraphemes(args.description.trim())
        .slice(0, 80)
        .join('');
      if (!description) throw new Error('Observer command description must not be empty.');
      const emoji = segmentConversationGraphemes(args.emoji.trim()).slice(0, 4).join('');

      stopResidentConversation(game, now, player.id);
      cancelResidentOperation(game, player.id);
      movePlayer(game, now, player, findNearbyOpenDestination(game, now, player, args.destination));
      player.activity = {
        description,
        ...(emoji ? { emoji } : {}),
        until: args.until,
      };
      return null;
    },
  }),
  eventTransfer: inputHandler({
    args: {
      playerId,
      destination: point,
      description: v.string(),
      until: v.number(),
    },
    handler: (game, now, args) => {
      const player = game.world.players.get(parseGameId('players', args.playerId));
      if (!player) throw new Error(`Event transfer resident not found: ${args.playerId}`);
      if (player.human) throw new Error('Event transfer is restricted to AI residents.');
      const transfer = prepareEventTransfer(game, now, args);
      stopResidentConversation(game, now, player.id);
      cancelResidentOperation(game, player.id);
      delete player.pathfinding;
      player.position = transfer.destination;
      player.speed = 0;
      player.activity = {
        description: transfer.description,
        emoji: '⛴️',
        until: transfer.until,
      };
      return null;
    },
  }),
  eventMove: inputHandler({
    args: {
      playerId,
      destination: point,
      description: v.string(),
      until: v.number(),
    },
    handler: (game, now, args) => {
      // Event phases are time-bounded. A delayed engine input must not pull a
      // resident back to an old venue after the event has already advanced.
      if (args.until < now) return null;
      const player = game.world.players.get(parseGameId('players', args.playerId));
      if (!player) return null;
      if (player.human) throw new Error('Event movement is restricted to AI residents.');
      stopResidentConversation(game, now, player.id);
      cancelResidentOperation(game, player.id);
      movePlayer(game, now, player, findNearbyOpenDestination(game, now, player, args.destination));
      player.activity = { description: args.description, until: args.until };
      return null;
    },
  }),
  finishRememberConversation: inputHandler({
    args: {
      operationId: v.string(),
      agentId,
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      if (
        !agent.inProgressOperation ||
        agent.inProgressOperation.operationId !== args.operationId
      ) {
        console.debug(`Agent ${agentId} isn't remembering ${args.operationId}`);
      } else {
        delete agent.inProgressOperation;
        delete agent.toRemember;
      }
      return null;
    },
  }),
  finishDoSomething: inputHandler({
    args: {
      operationId: v.string(),
      agentId: v.id('agents'),
      destination: v.optional(point),
      invitee: v.optional(v.id('players')),
      activity: v.optional(activity),
      activityDuration: v.optional(v.number()),
      activityRegistrationId: v.optional(v.id('activityRegistrations')),
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      if ((args.activityDuration === undefined) !== (args.activityRegistrationId === undefined)) {
        throw new Error('Registered activity input requires its server registration ID');
      }
      if (
        !agent.inProgressOperation ||
        agent.inProgressOperation.operationId !== args.operationId
      ) {
        console.debug(`Agent ${agentId} didn't have ${args.operationId} in progress`);
        if (args.activityDuration !== undefined && args.activityRegistrationId !== undefined) {
          return {
            activityRegistration: {
              operationId: args.operationId,
              registrationId: args.activityRegistrationId,
              agentId: agent.id,
              residentId: agent.playerId,
              status: 'rejected',
              acknowledgedAt: now,
              reason: 'operation-replaced',
            },
          };
        }
        return null;
      }
      delete agent.inProgressOperation;
      const player = game.world.players.get(agent.playerId)!;
      if (args.invitee) {
        const inviteeId = parseGameId('players', args.invitee);
        const invitee = game.world.players.get(inviteeId);
        if (!invitee) {
          throw new Error(`Couldn't find player: ${inviteeId}`);
        }
        Conversation.start(game, now, player, invitee);
        agent.lastInviteAttempt = now;
      }
      if (args.destination) {
        movePlayer(
          game,
          now,
          player,
          findNearbyOpenDestination(game, now, player, args.destination),
        );
      }
      if (args.activity) {
        if (args.activityDuration !== undefined && args.activityRegistrationId !== undefined) {
          if (
            !Number.isSafeInteger(args.activityDuration)
            || args.activityDuration <= 0
            || args.activityDuration > 86_400_000
          ) {
            throw new Error('Registered activity duration must be a positive bounded integer');
          }
          player.activity = { ...args.activity, until: now + args.activityDuration };
          return {
            activityRegistration: {
              operationId: args.operationId,
              registrationId: args.activityRegistrationId,
              agentId: agent.id,
              residentId: agent.playerId,
              status: 'activated',
              activatedAt: now,
              activityUntil: player.activity.until,
            },
          };
        }
        player.activity = args.activity;
      }
      return null;
    },
  }),
  agentFinishSendingMessage: inputHandler({
    args: {
      agentId,
      conversationId,
      timestamp: v.number(),
      operationId: v.string(),
      leaveConversation: v.boolean(),
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      const player = game.world.players.get(agent.playerId);
      if (!player) {
        throw new Error(`Couldn't find player: ${agent.playerId}`);
      }
      const conversationId = parseGameId('conversations', args.conversationId);
      const conversation = game.world.conversations.get(conversationId);
      if (!conversation) {
        throw new Error(`Couldn't find conversation: ${conversationId}`);
      }
      if (
        !agent.inProgressOperation ||
        agent.inProgressOperation.operationId !== args.operationId
      ) {
        console.debug(`Agent ${agentId} wasn't sending a message ${args.operationId}`);
        return null;
      }
      delete agent.inProgressOperation;
      conversationInputs.finishSendingMessage.handler(game, now, {
        playerId: agent.playerId,
        conversationId: args.conversationId,
        timestamp: args.timestamp,
      });
      if (args.leaveConversation) {
        conversation.leave(game, now, player);
      }
      return null;
    },
  }),
  createAgent: inputHandler({
    args: {
      descriptionIndex: v.number(),
    },
    handler: (game, now, args) => {
      const description = Descriptions[args.descriptionIndex];
      const playerId = Player.join(
        game,
        now,
        description.name,
        description.character,
        description.identity,
      );
      const agentId = game.allocId('agents');
      game.world.agents.set(
        agentId,
        new Agent({
          id: agentId,
          playerId: playerId,
          inProgressOperation: undefined,
          lastConversation: undefined,
          lastInviteAttempt: undefined,
          toRemember: undefined,
        }),
      );
      game.agentDescriptions.set(
        agentId,
        new AgentDescription({
          agentId: agentId,
          identity: description.identity,
          plan: description.plan,
        }),
      );
      return { agentId };
    },
  }),
};
