import { localizedDescriptions } from '../../data/worlds/lighthouse-town/characters';
import { dailyEventTemplates } from './dailyTemplates';
import {
  buildDailyEventDraft,
  buildMissedDailyEventDraft,
  restoreDailyEventState,
  serializeDailyEventState,
} from './dailyPersistence';
import { advanceDailyEventToStage } from './dailyStateMachine';

const dayKey = '2026-07-19';
const noon = Date.parse('2026-07-19T04:00:00Z');
const residents = localizedDescriptions('zh-CN').map((description, index) => ({
  residentId: `p:${index}`,
  displayName: description.name,
  identity: description.identity,
}));
const theme = {
  name: '荷香协作赛',
  announcement: '九位居民参加安全协作活动，退出者转入观众席。',
  source: 'fallback' as const,
};

describe('daily event persistence contract', () => {
  test('builds one complete nine-resident stage-zero draft with stable audit keys', () => {
    const draft = buildDailyEventDraft({
      worldId: 'world', dayKey, template: dailyEventTemplates[1], theme,
      residents, seed: 19, startedAt: noon,
    });

    expect(draft.event).toEqual(expect.objectContaining({
      dailyKey: dayKey,
      templateId: 'town-relay',
      eventName: theme.name,
      announcement: theme.announcement,
      venueMode: 'main-town',
      status: 'running',
      stageIndex: 0,
      phase: 'assembly',
      startedAt: noon,
      themeSource: 'fallback',
    }));
    expect(draft.participants).toHaveLength(9);
    expect(draft.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        residentId: 'p:0', identity: residents[0].identity, teamId: 'jade', score: 0,
        shells: 0, active: true, role: 'competitor', reachedFinal: false,
      }),
    ]));
    expect(draft.logs).toEqual([
      expect.objectContaining({
        eventKey: `daily:${dayKey}:announcement`, sequence: 0, stageIndex: 0,
        text: theme.announcement,
      }),
    ]);
  });

  test('fails closed unless the runtime roster maps exactly once to all configured residents', () => {
    const base = {
      worldId: 'world', dayKey, template: dailyEventTemplates[0], theme,
      seed: 19, startedAt: noon,
    };
    expect(() => buildDailyEventDraft({ ...base, residents: residents.slice(0, 8) }))
      .toThrow(/exactly nine/i);
    expect(() => buildDailyEventDraft({
      ...base,
      residents: residents.map((entry, index) => index === 8
        ? { ...entry, displayName: residents[0].displayName }
        : entry),
    })).toThrow(/configured|unique/i);
    expect(() => buildDailyEventDraft({
      ...base,
      residents: residents.map((entry, index) => index === 0
        ? { ...entry, identity: 'wrong identity' }
        : entry),
    })).toThrow(/identity/i);
  });

  test('round-trips catch-up stages, marks the top four finalists and emits stable keys', () => {
    const draft = buildDailyEventDraft({
      worldId: 'world', dayKey, template: dailyEventTemplates[0], theme,
      residents, seed: 19, startedAt: noon,
    });
    const state = restoreDailyEventState(draft.event, draft.participants, draft.logs);
    const stageFour = advanceDailyEventToStage(state, 4, noon + 75 * 60_000);
    const persisted = serializeDailyEventState(
      draft.event, draft.participants, stageFour, noon + 75 * 60_000,
    );

    expect(persisted.event).toEqual(expect.objectContaining({
      status: 'running', stageIndex: 4, phase: 'semifinal',
    }));
    expect(persisted.participants.filter((entry) => entry.reachedFinal)).toHaveLength(4);
    expect(new Set(persisted.logs.map((entry) => entry.eventKey)).size)
      .toBe(persisted.logs.length);
    expect(persisted.logs.map((entry) => entry.sequence)).toEqual([0, 1, 2, 3, 4]);
  });

  test('serializes stage six as one completed winner with endedAt and safe return audit', () => {
    const draft = buildDailyEventDraft({
      worldId: 'world', dayKey, template: dailyEventTemplates[0], theme,
      residents, seed: 19, startedAt: noon,
    });
    const complete = advanceDailyEventToStage(
      restoreDailyEventState(draft.event, draft.participants, draft.logs),
      6,
      noon + 2 * 60 * 60_000,
    );
    const persisted = serializeDailyEventState(
      draft.event, draft.participants, complete, noon + 2 * 60 * 60_000,
    );

    expect(persisted.event).toEqual(expect.objectContaining({
      status: 'completed', stageIndex: 6, phase: 'awards',
      endedAt: noon + 2 * 60 * 60_000, archiveReason: 'completed',
      winnerId: expect.any(String),
    }));
    expect(persisted.participants.filter((entry) => entry.role === 'winner')).toHaveLength(1);
    expect(persisted.participants.filter((entry) => entry.reachedFinal)).toHaveLength(4);
    expect(persisted.logs.at(-1)?.eventKey).toBe(`daily:${dayKey}:return`);
  });

  test('preserves persisted decision evidence while advancing the factual state', () => {
    const draft = buildDailyEventDraft({
      worldId: 'world', dayKey, template: dailyEventTemplates[1], theme,
      residents, seed: 19, startedAt: noon,
    });
    draft.participants[0] = {
      ...draft.participants[0], choiceId: 'observe', quote: '我先看清规则。', decisionStage: 0,
    };
    const next = advanceDailyEventToStage(
      restoreDailyEventState(draft.event, draft.participants, draft.logs), 1, noon + 10 * 60_000,
      { 'p:0': 'observe' },
    );
    const persisted = serializeDailyEventState(
      draft.event, draft.participants, next, noon + 10 * 60_000,
    );
    expect(persisted.participants[0]).toEqual(expect.objectContaining({
      choiceId: 'observe', quote: '我先看清规则。', decisionStage: 0,
    }));
  });

  test.each([
    ['running', 'missed-window'],
    ['inactive', 'world-paused'],
    ['stoppedByDeveloper', 'world-paused'],
  ] as const)('records an unplayed day as a participant-free fact for %s', (status, reason) => {
    const draft = buildMissedDailyEventDraft('world', dayKey, status, noon + 2 * 60 * 60_000);
    expect(draft.event).toEqual(expect.objectContaining({
      dailyKey: dayKey, status: 'completed', phase: 'missed', archiveReason: reason,
      endedAt: noon + 2 * 60 * 60_000,
    }));
    expect(draft.participants).toEqual([]);
    expect(draft.logs).toEqual([
      expect.objectContaining({ eventKey: `daily:${dayKey}:missed` }),
    ]);
  });
});
