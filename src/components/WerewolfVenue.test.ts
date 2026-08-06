import { readFileSync } from 'node:fs';

describe('dedicated werewolf venue', () => {
  test('exposes judge, table, speed, shrink and participant controls', () => {
    const source = readFileSync(new URL('./WerewolfVenue.tsx', import.meta.url), 'utf8');
    expect(source).toContain('狼人杀法官');
    expect(source).toContain('werewolf-round-table');
    expect(source).toContain('缩回小镇');
    expect(source).toContain('submitHumanAction');
    expect(source).toContain('发送本轮发言');
    expect(source).toContain('女巫行动');
    expect(source).toContain('useJudgeVoice');
    expect(source).toContain('judgeSpeechKey');
    expect(source).toContain('voiceName');
  });

  test('game can switch to the venue without moving world heartbeat ownership', () => {
    const game = readFileSync(new URL('./Game.tsx', import.meta.url), 'utf8');
    expect(game).toContain('<WerewolfVenue');
    expect(game.indexOf('useWorldHeartbeat();')).toBeLessThan(game.indexOf('if (venueOpen'));
  });
});
