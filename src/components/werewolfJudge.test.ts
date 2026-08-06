import { judgeCue, WEREWOLF_PHASE_ORDER } from './werewolfJudge';

describe('werewolf judge presentation', () => {
  test('begins with night and never calls the first phase a vote', () => {
    expect(WEREWOLF_PHASE_ORDER[0]).toBe('night-wolves');
    expect(judgeCue({ phase: 'night-wolves', round: 1 }).line)
      .toBe('天黑请闭眼。狼人请睁眼，商量今晚的目标。');
    expect(judgeCue({ phase: 'night-wolves', round: 1 }).line).not.toMatch(/投票/u);
  });

  test('announces daylight before speaking and voting', () => {
    expect(judgeCue({ phase: 'dawn', round: 1, dawnDepartures: [] }).line)
      .toBe('天亮了。昨夜平安，无人离场。');
    expect(judgeCue({ phase: 'dawn', round: 1, dawnDepartures: ['白露', '墨七'] }).line)
      .toBe('天亮了。昨夜白露、墨七离场，已安全前往观众席。');
    expect(judgeCue({ phase: 'day-speaking', round: 1, speakingPlayerName: '林澜' }).line)
      .toContain('林澜');
    expect(judgeCue({ phase: 'day-voting', round: 1 }).line).toContain('开始投票');
  });
});
