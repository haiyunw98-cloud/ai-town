import * as eventsModule from '../events';
import { localizedDescriptions } from '../../data/worlds/lighthouse-town/characters';
import { readFileSync } from 'node:fs';

const events = eventsModule as unknown as {
  isDailyThemeSaveEligible: (
    event: { dailyKey?: string; status: string; stageIndex?: number; themeSource?: string },
    worldStatus: string,
    dayKey: string,
  ) => boolean;
  selectDailyDecisionCandidate: (
    event: {
      dailyKey?: string; templateId?: string; status: string; stageIndex?: number;
    },
    participants: Array<{
      residentId: string; displayName: string; identity: string; active: boolean;
      decisionStage?: number;
    }>,
  ) => null | { residentId: string; stageIndex: number; choices: Array<{ id: string }> };
  selectConfiguredAiRoster: (
    world: { players: Array<{ id: string; human?: string }>; agents: Array<{ id: string; playerId: string }> },
    players: Array<{ playerId: string; name: string; description: string }>,
    agents: Array<{ agentId: string; identity: string }>,
  ) => Array<{ residentId: string }>;
  selectDailyStateLogs: <T extends { eventKey: string; sequence: number }>(
    rows: readonly T[], dayKey: string,
  ) => T[];
  selectInterruptedCrossDayEvent: <T extends {
    dailyKey?: string; status: string;
  }>(rows: readonly T[], currentDayKey: string) => T | null;
};

describe('daily model persistence eligibility', () => {
  test('declares and uses the bounded isDefault world-status index', () => {
    const schema = readFileSync('convex/aiTown/schema.ts', 'utf8');
    const source = readFileSync('convex/events.ts', 'utf8');
    expect(schema).toContain(".index('isDefault', ['isDefault'])");
    expect(source).not.toContain(".filter((q) => q.eq(q.field('isDefault'), true))");
    expect(source.match(/\.withIndex\('isDefault', \(q\) => q\.eq\('isDefault', true\)\)/gu))
      .toHaveLength(7);
  });

  test('classifies exactly one older daily event while ignoring legacy and today rows', () => {
    const legacy = { id: 'legacy', status: 'running' };
    const today = { id: 'today', dailyKey: '2026-07-19', status: 'running' };
    const yesterday = { id: 'yesterday', dailyKey: '2026-07-18', status: 'running' };
    expect(events.selectInterruptedCrossDayEvent([legacy, today], '2026-07-19')).toBeNull();
    expect(events.selectInterruptedCrossDayEvent([legacy, yesterday, today], '2026-07-19'))
      .toBe(yesterday);
    expect(() => events.selectInterruptedCrossDayEvent([
      yesterday,
      { id: 'older', dailyKey: '2026-07-17', status: 'running' },
    ], '2026-07-19')).toThrow(/multiple|ambiguous/i);
    expect(() => events.selectInterruptedCrossDayEvent([
      { id: 'future', dailyKey: '2026-07-20', status: 'running' },
    ], '2026-07-19')).toThrow(/future/i);
  });

  test('declares a bounded running-day lookup for cross-day recovery', () => {
    const schema = readFileSync('convex/schema.ts', 'utf8');
    const source = readFileSync('convex/events.ts', 'utf8');
    expect(schema).toContain(".index('worldStatusDay', ['worldId', 'status', 'dailyKey'])");
    expect(source).toContain(".withIndex('worldStatusDay', (q) =>\n      q.eq('worldId', worldStatus.worldId).eq('status', 'running'),\n    )\n    .take(4)");
  });
  test('accepts a theme only for a still-running stage-zero event on the same day', () => {
    const event = {
      dailyKey: '2026-07-19', status: 'running', stageIndex: 0, themeSource: 'fallback',
    };
    expect(events.isDailyThemeSaveEligible(event, 'running', '2026-07-19')).toBe(true);
    expect(events.isDailyThemeSaveEligible({ ...event, stageIndex: 1 }, 'running', '2026-07-19'))
      .toBe(false);
    expect(events.isDailyThemeSaveEligible(event, 'inactive', '2026-07-19')).toBe(false);
    expect(events.isDailyThemeSaveEligible(event, 'running', '2026-07-20')).toBe(false);
    expect(events.isDailyThemeSaveEligible({ ...event, dailyKey: undefined }, 'running', '2026-07-19'))
      .toBe(false);
  });

  test('selects only one active undecided resident from a known daily stage', () => {
    const participants = [
      { residentId: 'p:0', displayName: '林澜', identity: 'identity', active: true, decisionStage: 2 },
      { residentId: 'p:1', displayName: '沈砚', identity: 'identity', active: false },
      { residentId: 'p:2', displayName: '唐果', identity: 'identity', active: true },
    ];
    const event = {
      dailyKey: '2026-07-19', templateId: 'town-relay', status: 'running', stageIndex: 2,
    };
    expect(events.selectDailyDecisionCandidate(event, participants)).toEqual(
      expect.objectContaining({ residentId: 'p:2', stageIndex: 2, choices: expect.any(Array) }),
    );
    expect(events.selectDailyDecisionCandidate({ ...event, dailyKey: undefined }, participants))
      .toBeNull();
    expect(events.selectDailyDecisionCandidate({ ...event, templateId: 'unknown' }, participants))
      .toBeNull();
    expect(events.selectDailyDecisionCandidate({ ...event, status: 'completed' }, participants))
      .toBeNull();
  });

  test('selects the exact nine configured AI mappings while ignoring a human observer', () => {
    const descriptions = localizedDescriptions('zh-CN');
    const world = {
      players: [
        ...descriptions.map((_entry, index) => ({ id: `p:${index}` })),
        { id: 'p:human', human: 'observer' },
      ],
      agents: descriptions.map((_entry, index) => ({ id: `a:${index}`, playerId: `p:${index}` })),
    };
    const players = [
      ...descriptions.map((entry, index) => ({
        playerId: `p:${index}`, name: entry.name, description: entry.identity,
      })),
      { playerId: 'p:human', name: '观察者', description: 'human' },
    ];
    const agents = [
      ...descriptions.map((entry, index) => ({ agentId: `a:${index}`, identity: entry.identity })),
      { agentId: 'a:stale', identity: 'stale' },
    ];
    expect(events.selectConfiguredAiRoster(world, players, agents)).toHaveLength(9);
    expect(() => events.selectConfiguredAiRoster(world, [...players, players[0]], agents))
      .toThrow(/ambiguous/i);
  });

  test('restores only state-machine logs when interviews are interleaved', () => {
    const rows = [
      { eventKey: 'daily:2026-07-19:decision:0:p:0', sequence: 1 },
      { eventKey: 'daily:2026-07-19:stage:1', sequence: 1 },
      { eventKey: 'daily:2026-07-19:announcement', sequence: 0 },
      { eventKey: 'legacy:announcement', sequence: 0 },
    ];
    expect(events.selectDailyStateLogs(rows, '2026-07-19').map((row) => row.eventKey)).toEqual([
      'daily:2026-07-19:announcement',
      'daily:2026-07-19:stage:1',
    ]);
  });
});
