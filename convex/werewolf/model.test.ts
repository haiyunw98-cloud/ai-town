import type { LLMConfig } from '../util/llmConfig';
import type { WerewolfViewerState } from './privacy';
import { buildWerewolfPrompt, requestWerewolfAction } from './model';

const config: LLMConfig = {
  provider: 'ollama',
  url: 'http://127.0.0.1:11434',
  chatModel: 'gemma4:12b',
  embeddingModel: 'mxbai-embed-large',
  embeddingDimension: 1024,
  reasoningEffort: 'none',
  stopWords: [],
  apiKey: undefined,
};

function villagerView(): WerewolfViewerState {
  return {
    phase: 'day-speaking',
    round: 1,
    seats: [
      { playerId: 'p:3', displayName: '林澜', seatNumber: 4, alive: true },
      { playerId: 'p:4', displayName: '唐果', seatNumber: 5, alive: true },
    ],
    publicActions: [],
    privateRole: 'villager',
    legalTargets: ['p:4'],
    pendingHumanAction: 'speech',
    speakingPlayerId: 'p:3',
    runoffIds: [],
  };
}

function depsReturning(content: string) {
  return {
    getConfig: () => config,
    complete: async () => ({ content }),
  };
}

describe('werewolf local model decisions', () => {
  test('prompt contains the resident identity but no server-only state fields', () => {
    const prompt = buildWerewolfPrompt(
      villagerView(), '林澜温和谨慎，重视具体证据。', 'speech',
    );
    expect(prompt).toContain('你是林澜');
    expect(prompt).toContain('温和谨慎');
    expect(prompt).not.toMatch(/pendingNightTargetId|privateResults|wolf-vote/u);
  });

  test.each([
    '',
    '{"text":"后台身份是狼人"}',
    '{"targetId":"not-alive"}',
  ])('uses deterministic fallback for unsafe or invalid output', async (content) => {
    const requested = content.includes('targetId') ? 'target' as const : 'speech' as const;
    const result = await requestWerewolfAction({
      view: villagerView(), identity: '林澜温和谨慎。', requested, seedKey: 'session:1:p:3',
    }, depsReturning(content));
    expect(result.source).toBe('fallback');
  });

  test('accepts a natural short speech and rejects violent prose', async () => {
    const input = {
      view: villagerView(), identity: '林澜温和谨慎。', requested: 'speech' as const,
      seedKey: 'session:1:p:3',
    };
    await expect(requestWerewolfAction(input, depsReturning(
      '{"text":"我暂时相信五号，再听一轮。"}',
    ))).resolves.toEqual({ source: 'model', text: '我暂时相信五号，再听一轮。' });
    await expect(requestWerewolfAction(input, depsReturning(
      '{"text":"我要让对方流血受伤。"}',
    ))).resolves.toMatchObject({ source: 'fallback' });
  });

  test('accepts only targets included in the private legal target list', async () => {
    const result = await requestWerewolfAction({
      view: villagerView(), identity: '林澜温和谨慎。', requested: 'target',
      seedKey: 'session:1:p:3',
    }, depsReturning('{"targetId":"p:4"}'));
    expect(result).toEqual({ source: 'model', targetId: 'p:4' });
  });
});
