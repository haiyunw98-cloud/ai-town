import { readFileSync } from 'node:fs';

describe('judge voice lifecycle', () => {
  test('uses local speech synthesis and cancels stale or hidden narration', () => {
    const source = readFileSync(new URL('./useJudgeVoice.ts', import.meta.url), 'utf8');
    expect(source).toContain('SpeechSynthesisUtterance');
    expect(source).toContain("utterance.lang = 'zh-CN'");
    expect(source).toContain('utterance.rate = 0.95');
    expect(source).toContain('utterance.pitch = 1.06');
    expect(source).toContain('speechSynthesis.cancel()');
    expect(source).toContain('visibilitychange');
  });
});
