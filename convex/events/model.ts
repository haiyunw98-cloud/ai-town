import {
  CreateChatCompletionRequest,
  getLLMConfig,
  LLMConfig,
  localChatCompletionOnce,
} from '../util/llm';
import { segmentConversationGraphemes } from '../util/conversationText';
import type { DailyStageId } from './dailyTemplates';
import { isLocalDailyEventGemma } from './localGemmaPolicy';
import { EventPhase } from './types';

export type EventChoice = Readonly<{
  id: string;
  label: string;
}>;

export type EventDecisionInput = {
  residentId: string;
  displayName: string;
  identity: string;
  phase: EventPhase | DailyStageId;
  stageLabel: string;
  choices: readonly EventChoice[];
};

export type EventDecision = {
  choiceId: string;
  publicQuote: string;
  source: 'model' | 'fallback';
};

export type EventCompletionBody = Omit<CreateChatCompletionRequest, 'model' | 'stream'> & {
  model?: string;
  stream?: false;
};

type EventModelDependencies = {
  getConfig: () => LLMConfig;
  complete: (body: EventCompletionBody) => Promise<{ content: string }>;
};

const defaultDependencies: EventModelDependencies = {
  getConfig: getLLMConfig,
  complete: (body) => localChatCompletionOnce({
    ...body,
    model: body.model ?? getLLMConfig().chatModel,
    stream: false,
  }),
};

const unsafePublicQuote = /死亡|死伤|伤亡|受伤|处决|流血|血腥|杀死|毙命/u;

export function buildEventDecisionPrompt(input: EventDecisionInput) {
  const choices = input.choices.map((choice) => `- ${choice.id}: ${choice.label}`).join('\n');
  return [
    `你是${input.displayName}。${input.identity}`,
    `当前赛事阶段是 ${input.phase}，现场项目是「${input.stageLabel}」。`,
    '请依据你的性格选择一个行动，并给出一句可以公开播出的赛场发言。发言只谈这个项目的眼前动作、进度、队友或感受，不复述平日旧话题，不谈高塔、航行、河道、水位、机关或异变。',
    choices,
    '只选择上面列出的 choiceId。publicQuote 不超过 60 个中文字符，不暴露隐藏推理。',
    '只输出 JSON：{"choiceId":"...","publicQuote":"..."}',
  ].join('\n');
}

export async function requestEventDecision(
  input: EventDecisionInput,
  dependencies: EventModelDependencies = defaultDependencies,
): Promise<EventDecision> {
  validateChoices(input.choices);
  try {
    const config = dependencies.getConfig();
    if (!isLocalDailyEventGemma(config)) return fallbackDecision(input);
    const result = await dependencies.complete({
      model: config.chatModel,
      messages: [
        {
          role: 'system',
          content: '你正在为全年龄的灯塔镇活动生成简短、自然的简体中文公开发言。',
        },
        { role: 'user', content: buildEventDecisionPrompt(input) },
      ],
      max_tokens: 96,
      temperature: 0.6,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(result.content) as { choiceId?: unknown; publicQuote?: unknown };
    if (
      typeof parsed.choiceId !== 'string' ||
      !input.choices.some((choice) => choice.id === parsed.choiceId) ||
      !isSafePublicQuote(parsed.publicQuote)
    ) {
      return fallbackDecision(input);
    }
    return {
      choiceId: parsed.choiceId,
      publicQuote: parsed.publicQuote.trim(),
      source: 'model',
    };
  } catch {
    return fallbackDecision(input);
  }
}

function validateChoices(choices: readonly EventChoice[]) {
  if (choices.length < 2) throw new Error('Event decisions require at least two choices.');
  if (new Set(choices.map((choice) => choice.id)).size !== choices.length) {
    throw new Error('Event choice IDs must be unique.');
  }
}

function isSafePublicQuote(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return (
    !!normalized &&
    !unsafePublicQuote.test(normalized) &&
    segmentConversationGraphemes(normalized).length <= 60
  );
}

function fallbackDecision(input: EventDecisionInput): EventDecision {
  const index = stableIndex(`${input.residentId}:${input.phase}`, input.choices.length);
  const choice = input.choices[index];
  return {
    choiceId: choice.id,
    publicQuote: '我点点头：“先把眼前这一关做好。”',
    source: 'fallback',
  };
}

function stableIndex(value: string, modulo: number) {
  let hash = 0;
  for (const character of value) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % modulo;
}
