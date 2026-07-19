import { dailyEventTemplates } from './dailyTemplates';
import {
  advanceDailyEventToStage,
  createDailyEventState,
  type DailyEventState,
} from './dailyStateMachine';

const start = Date.parse('2026-07-17T04:00:00Z');
const template = dailyEventTemplates[0];
const residents9 = [
  '林澜',
  '沈砚',
  '唐果',
  '墨七',
  '苏萤',
  '白露',
  '顾潮',
  '阿满',
  '玄微先生',
].map((displayName, index) => ({ residentId: `p:${index}`, displayName }));

const createState = () =>
  createDailyEventState('world', residents9, template, '2026-07-17', 17, start);

describe('daily event state machine', () => {
  test('requires exactly nine unique, non-empty resident identities', () => {
    expect(() =>
      createDailyEventState('world', residents9.slice(0, 8), template, '2026-07-17', 17, start),
    ).toThrow(/exactly nine/i);
    expect(() =>
      createDailyEventState(
        'world',
        [...residents9, { residentId: 'p:9', displayName: '额外居民' }],
        template,
        '2026-07-17',
        17,
        start,
      ),
    ).toThrow(/exactly nine/i);
    expect(() =>
      createDailyEventState(
        'world',
        residents9.map((resident, index) =>
          index === 8 ? { ...resident, residentId: residents9[0].residentId } : resident,
        ),
        template,
        '2026-07-17',
        17,
        start,
      ),
    ).toThrow(/unique/i);
    expect(() =>
      createDailyEventState(
        'world',
        residents9.map((resident, index) =>
          index === 0 ? { ...resident, displayName: '   ' } : resident,
        ),
        template,
        '2026-07-17',
        17,
        start,
      ),
    ).toThrow(/non-empty/i);
  });

  test('assigns stable balanced teams independently of input order', () => {
    const first = createState();
    const reversed = createDailyEventState(
      'world',
      [...residents9].reverse(),
      template,
      '2026-07-17',
      17,
      start,
    );
    const teams = (state: DailyEventState) =>
      Object.fromEntries(state.participants.map((entry) => [entry.residentId, entry.teamId]));

    expect(teams(reversed)).toEqual(teams(first));
    expect(first.participants.filter((entry) => entry.teamId === 'jade')).toHaveLength(5);
    expect(first.participants.filter((entry) => entry.teamId === 'amber')).toHaveLength(4);
  });

  test('advances all seven stages and completes with one winner and eight spectators', () => {
    let state = createState();
    for (let stageIndex = 1; stageIndex <= 6; stageIndex += 1) {
      state = advanceDailyEventToStage(state, stageIndex, start + stageIndex * 1_000);
    }

    expect(state.stageIndex).toBe(6);
    expect(state.status).toBe('completed');
    expect(state.participants.filter((entry) => entry.role === 'winner')).toHaveLength(1);
    expect(state.participants.filter((entry) => entry.role === 'spectator')).toHaveLength(8);
    expect(state.participants.filter((entry) => entry.active)).toHaveLength(1);
    expect(state.log.map((entry) => entry.stageIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 6]);
    expect(state.log.map((entry) => entry.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(state.log.every((entry, index) => index === 0 || entry.createdAt >= state.log[index - 1].createdAt)).toBe(true);
    expect(state.log.some((entry) => /死亡|受伤|处决|流血/u.test(entry.text))).toBe(false);
  });

  test('settles every skipped stage rather than jumping over results', () => {
    const state = createState();
    const finished = advanceDailyEventToStage(state, 6, start + 6_000);

    expect(finished.status).toBe('completed');
    expect(finished.log.map((entry) => entry.stageIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 6]);
    expect(finished.participants.filter((entry) => entry.role === 'winner')).toHaveLength(1);
    expect(finished.participants.filter((entry) => entry.role === 'spectator')).toHaveLength(8);
    expect(finished.log.every((entry, index) => index === 0 || entry.createdAt > finished.log[index - 1].createdAt || entry.stageIndex === 6)).toBe(true);
  });

  test('returns the identical state object for duplicate or backward progression', () => {
    const state = createState();
    const once = advanceDailyEventToStage(state, 2, start + 2_000);

    expect(advanceDailyEventToStage(once, 2, start + 3_000)).toBe(once);
    expect(advanceDailyEventToStage(once, 1, start + 3_000)).toBe(once);
    const finished = advanceDailyEventToStage(once, 6, start + 6_000);
    expect(advanceDailyEventToStage(finished, 6, start + 7_000)).toBe(finished);
  });

  test.each([-1, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'fails closed for illegal target stage %s',
    (target) => {
      expect(() => advanceDailyEventToStage(createState(), target, start + 1_000)).toThrow(
        RangeError,
      );
    },
  );

  test('fails closed for invalid or non-monotonic timestamps', () => {
    for (const timestamp of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(() =>
        createDailyEventState('world', residents9, template, '2026-07-17', 17, timestamp),
      ).toThrow(RangeError);
      expect(() => advanceDailyEventToStage(createState(), 1, timestamp)).toThrow(RangeError);
    }
    expect(() => advanceDailyEventToStage(createState(), 1, start)).toThrow(/later/i);
    const stageOne = advanceDailyEventToStage(createState(), 1, start + 1_000);
    expect(() => advanceDailyEventToStage(stageOne, 0, start - 1)).toThrow(/timestamp/i);
  });

  test('does not mutate resident, template, state or decision inputs', () => {
    const residents = residents9.map((resident) => ({ ...resident }));
    const residentsBefore = structuredClone(residents);
    const templateBefore = structuredClone(template);
    const state = createDailyEventState(
      'world',
      residents,
      template,
      '2026-07-17',
      17,
      start,
    );
    const stateBefore = structuredClone(state);
    const decisions = { 'p:0': 'steady', 'p:1': 'not-a-choice' };
    const decisionsBefore = { ...decisions };

    advanceDailyEventToStage(state, 1, start + 1_000, decisions);

    expect(residents).toEqual(residentsBefore);
    expect(template).toEqual(templateBefore);
    expect(state).toEqual(stateBefore);
    expect(decisions).toEqual(decisionsBefore);
  });

  test('only current-stage finite choice IDs can affect deterministic scoring', () => {
    const state = createState();
    const omitted = advanceDailyEventToStage(state, 1, start + 1_000);
    const invalid = advanceDailyEventToStage(state, 1, start + 1_000, {
      'p:0': 'invented-choice',
      outsider: 'steady',
    });
    const valid = advanceDailyEventToStage(state, 1, start + 1_000, { 'p:0': 'steady' });

    expect(invalid).toEqual(omitted);
    expect(valid.participants.find((entry) => entry.residentId === 'p:0')?.score).not.toBe(
      omitted.participants.find((entry) => entry.residentId === 'p:0')?.score,
    );
  });
});
