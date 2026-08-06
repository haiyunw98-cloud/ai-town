import {
  CreateChatCompletionRequest,
  getLLMConfig,
  LLMConfig,
  localChatCompletionOnce,
} from '../util/llm';
import { segmentConversationGraphemes } from '../util/conversationText';
import { isLocalDailyEventGemma } from '../events/localGemmaPolicy';
import type { WerewolfViewerState } from './privacy';
import type { WerewolfAction } from './types';

export type WerewolfRequestedAction = 'speech' | 'target' | 'witch';

export type WerewolfModelResult = {
  source: 'model' | 'fallback';
  text?: string;
  targetId?: string;
  save?: boolean;
};

export type WerewolfModelInput = {
  view: WerewolfViewerState;
  identity: string;
  requested: WerewolfRequestedAction;
  seedKey: string;
};

type CompletionBody = Omit<CreateChatCompletionRequest, 'model' | 'stream'> & {
  model?: string;
  stream?: false;
};

type Dependencies = {
  getConfig: () => LLMConfig;
  complete: (body: CompletionBody) => Promise<{ content: string }>;
};

const defaultDependencies: Dependencies = {
  getConfig: getLLMConfig,
  complete: (body) => localChatCompletionOnce({
    ...body,
    model: body.model ?? getLLMConfig().chatModel,
    stream: false,
  }),
};

const unsafeSpeech = /后台|系统提示|隐藏身份|真实身份|流血|血腥|杀死|毙命|死亡|死伤|伤亡|受伤|处决/u;

function viewerName(view: WerewolfViewerState) {
  const playerId = view.viewerId ?? view.speakingPlayerId;
  return view.seats.find((seat) => seat.playerId === playerId)?.displayName ??
    view.seats[0]?.displayName ?? '灯塔镇居民';
}

export function buildWerewolfPrompt(
  view: WerewolfViewerState,
  identity: string,
  requested: WerewolfRequestedAction,
) {
  const residents = view.seats.map((seat) =>
    `${seat.seatNumber}号 ${seat.displayName}（${seat.alive ? '仍在场' : '已去观众席'}）`,
  ).join('；');
  const publicSpeech = view.publicActions
    .filter((action): action is Extract<WerewolfAction, { kind: 'speech' }> =>
      action.kind === 'speech')
    .slice(-12)
    .map((action) => `${action.actorId}：${action.text}`)
    .join('\n') || '暂无公开发言。';
  const request = requested === 'speech'
    ? `请自然说一句本轮判断，最多${view.phase === 'runoff-speaking' ? 40 : 80}字。只输出 {"text":"..."}。`
    : requested === 'target'
      ? `从合法目标 ${JSON.stringify(view.legalTargets)} 中选择一个。只输出 {"targetId":"..."}。`
      : `你可救人或使用毒药；可用解药=${view.antidoteAvailable === true}，可用毒药=${view.poisonAvailable === true}，今夜目标=${view.witchNoticeTargetId ?? '无'}，毒药合法目标=${JSON.stringify(view.legalTargets)}。只输出 {"save":true|false,"targetId":"可省略"}。`;
  return [
    `你是${viewerName(view)}。${identity}`,
    `这是安全、无人受伤的灯塔镇狼人杀，第 ${view.round} 轮，当前阶段 ${view.phase}。`,
    `你的身份：${view.privateRole ?? '未知'}。`,
    view.knownWolfIds ? `你知道的狼队成员：${view.knownWolfIds.join('、')}。` : '',
    view.seerResults?.length ? `你的查验记录：${JSON.stringify(view.seerResults)}。` : '',
    `在场信息：${residents}`,
    `公开发言：\n${publicSpeech}`,
    '只根据以上视角行动。短句、多轮、像真人聊天；不谈工作、河道、灯火、异变或旧剧情，不输出后台说明和隐藏推理。',
    request,
  ].filter(Boolean).join('\n');
}

function validSpeech(value: unknown, limit: number): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return !!text && !unsafeSpeech.test(text) && segmentConversationGraphemes(text).length <= limit;
}

export async function requestWerewolfAction(
  input: WerewolfModelInput,
  dependencies: Dependencies = defaultDependencies,
): Promise<WerewolfModelResult> {
  try {
    const config = dependencies.getConfig();
    if (!isLocalDailyEventGemma(config)) return fallback(input);
    const completion = await dependencies.complete({
      model: config.chatModel,
      messages: [
        { role: 'system', content: '你为全年龄狼人杀生成简短自然的简体中文行动，只返回 JSON。' },
        { role: 'user', content: buildWerewolfPrompt(input.view, input.identity, input.requested) },
      ],
      max_tokens: input.requested === 'speech' ? 128 : 48,
      temperature: 0.65,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(completion.content) as {
      text?: unknown;
      targetId?: unknown;
      save?: unknown;
    };
    if (input.requested === 'speech') {
      const limit = input.view.phase === 'runoff-speaking' ? 40 : 80;
      if (!validSpeech(parsed.text, limit)) return fallback(input);
      return { source: 'model', text: parsed.text.trim() };
    }
    if (input.requested === 'target') {
      if (typeof parsed.targetId !== 'string' ||
          !input.view.legalTargets.includes(parsed.targetId)) return fallback(input);
      return { source: 'model', targetId: parsed.targetId };
    }
    if (typeof parsed.save !== 'boolean') return fallback(input);
    const targetId = typeof parsed.targetId === 'string' ? parsed.targetId : undefined;
    if ((parsed.save && targetId) ||
        (parsed.save && (!input.view.antidoteAvailable || !input.view.witchNoticeTargetId)) ||
        (targetId && (!input.view.poisonAvailable || !input.view.legalTargets.includes(targetId)))) {
      return fallback(input);
    }
    return { source: 'model', save: parsed.save, ...(targetId ? { targetId } : {}) };
  } catch {
    return fallback(input);
  }
}

function fallback(input: WerewolfModelInput): WerewolfModelResult {
  if (input.requested === 'speech') {
    const lines = [
      '我先记下大家的说法，暂时不急着下结论。',
      '这轮我更在意前后说法是否一致。',
      '我会结合刚才的发言和票型再判断。',
    ];
    return { source: 'fallback', text: lines[stableIndex(input.seedKey, lines.length)] };
  }
  if (input.requested === 'witch') {
    if (input.view.antidoteAvailable && input.view.witchNoticeTargetId) {
      return { source: 'fallback', save: true };
    }
    return { source: 'fallback', save: false };
  }
  const targets = input.view.legalTargets;
  return {
    source: 'fallback',
    ...(targets.length ? { targetId: targets[stableIndex(input.seedKey, targets.length)] } : {}),
  };
}

function stableIndex(value: string, modulo: number) {
  let hash = 0;
  for (const character of value) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % modulo;
}
