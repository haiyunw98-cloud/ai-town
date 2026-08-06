import { judgeSpeechKey, selectLocalJudgeVoice } from './judgeVoice';

type VoiceStub = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'default' | 'localService'>;
const voice = (name: string, lang: string, localService = true, isDefault = false): VoiceStub => ({
  name, lang, localService, default: isDefault,
});

describe('local female judge voice', () => {
  test('prefers the approved local Chinese female voices in order', () => {
    const voices = [voice('普通中文', 'zh-CN'), voice('Sandy', 'en-US'), voice('Tingting', 'zh-CN')];
    expect(selectLocalJudgeVoice(voices)?.name).toBe('Tingting');
  });

  test('falls back to another local Chinese voice, never a remote voice when local exists', () => {
    const voices = [voice('Remote Tingting', 'zh-CN', false), voice('本地中文', 'zh-CN', true)];
    expect(selectLocalJudgeVoice(voices)?.name).toBe('本地中文');
  });

  test('builds a stable deduplication key for one spoken subtitle', () => {
    expect(judgeSpeechKey('game:7', 'night-wolves', 1, '天黑请闭眼。'))
      .toBe('game:7:1:night-wolves:天黑请闭眼。');
  });
});
