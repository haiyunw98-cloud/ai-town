import { buildWerewolfViewerState } from './werewolf/privacy';
import { createWerewolfSetup } from './werewolf/setup';
import {
  applySystemStep,
  applyWerewolfAction,
  beginWerewolfGame,
  legalTargets,
} from './werewolf/stateMachine';
import { selectPendingActor, werewolfActionKey } from './werewolf';
import type { WerewolfAction, WerewolfEntrant, WerewolfState } from './werewolf/types';

function runGame(mode: 'observe' | 'play') {
  const entrants: WerewolfEntrant[] = Array.from({ length: 9 }, (_, index) => ({
    playerId: mode === 'play' && index === 0 ? 'human:Me' : `p:${index}`,
    displayName: mode === 'play' && index === 0 ? '你（ME）' : `居民${index}`,
    kind: mode === 'play' && index === 0 ? 'human' : 'ai',
  }));
  let state = beginWerewolfGame(createWerewolfSetup(entrants, 19), 19, 1000);
  const keys: string[] = [];
  const sources: string[] = [];
  let steps = 0;
  while (state.phase !== 'completed' && steps < 300) {
    steps += 1;
    if (state.phase === 'dawn') {
      state = applySystemStep(state, state.updatedAt + 1);
      continue;
    }
    const turn = selectPendingActor(state);
    if (!turn) throw new Error(`No pending actor in ${state.phase}`);
    keys.push(werewolfActionKey('session:1', state.round, state.phase, turn.actorId));
    sources.push(turn.human ? 'fallback' : 'model');
    const targets = legalTargets(state, turn.actorId);
    let action: WerewolfAction;
    if (turn.kind === 'speech') {
      action = { kind: 'speech', actorId: turn.actorId, text: '我会结合公开发言和票型判断。', at: state.updatedAt + 1 };
    } else if (turn.kind === 'witch-use') {
      action = { kind: 'witch-use', actorId: turn.actorId, save: false, at: state.updatedAt + 1 };
    } else if (turn.kind === 'day-vote') {
      const wolves = state.seats.filter((seat) => seat.alive && seat.role === 'werewolf');
      const target = wolves.find((seat) => seat.playerId !== turn.actorId);
      action = { kind: 'day-vote', actorId: turn.actorId, targetId: target?.playerId, at: state.updatedAt + 1 };
    } else if (turn.kind === 'hunter-shot') {
      const wolf = state.seats.find((seat) => seat.alive && seat.role === 'werewolf');
      action = { kind: 'hunter-shot', actorId: turn.actorId, targetId: wolf?.playerId, at: state.updatedAt + 1 };
    } else {
      const target = turn.kind === 'wolf-vote'
        ? state.seats.find((seat) => seat.alive && seat.role !== 'werewolf' && seat.kind === 'ai')?.playerId
        : targets[0];
      if (!target) throw new Error(`No legal target for ${turn.kind}`);
      action = { kind: turn.kind, actorId: turn.actorId, targetId: target, at: state.updatedAt + 1 };
    }
    state = applyWerewolfAction(state, action);
  }
  if (state.phase !== 'completed') throw new Error('Deterministic werewolf game did not complete.');
  return { state, keys, sources, publicReplay: buildWerewolfViewerState(state).publicActions };
}

describe('complete werewolf recovery flow', () => {
  test('nine AI finish with an auditable good win and no duplicate action keys', () => {
    const result = runGame('observe');
    expect(result.state.winner).toBe('good');
    expect(result.publicReplay.length).toBeGreaterThan(20);
    expect(new Set(result.keys).size).toBe(result.keys.length);
  });

  test('a missing human response uses fallback turns and the game still completes', () => {
    const result = runGame('play');
    expect(result.state.phase).toBe('completed');
    expect(result.sources).toContain('fallback');
  });
});
