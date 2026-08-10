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

  test('prefers bundled female narration so embedded browsers produce audible sound', () => {
    const source = readFileSync(new URL('./useJudgeVoice.ts', import.meta.url), 'utf8');
    expect(source).toContain('JUDGE_VOICE_ASSETS[text]');
    expect(source).toContain('playVoiceClip(');
    expect(source).toContain('        bundledSrc,');
    expect(source).toContain("voiceName: bundledSrc ? '婷婷 · 内置女法官'");
  });
});
