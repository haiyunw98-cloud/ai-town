import {
  chatCompletion,
  type CreateChatCompletionRequest,
  getLLMConfig,
  type LLMConfig,
} from '../util/llm';
import type { DailyEventTemplate } from './dailyTemplates';

export type DailyTheme = {
  name: string;
  announcement: string;
  source: 'model' | 'fallback';
};

type ThemeCompletionBody = Omit<CreateChatCompletionRequest, 'model' | 'stream'> & {
  model?: string;
  stream?: false;
};

type ThemeDependencies = {
  getConfig: () => LLMConfig;
  complete: (body: ThemeCompletionBody) => Promise<{ content: string }>;
};

const unsafeThemeText = /死亡|死伤|伤亡|受伤|处决|流血|血腥|杀死|毙命/u;

const defaultDependencies: ThemeDependencies = {
  getConfig: getLLMConfig,
  complete: (body) => chatCompletion({ ...body, stream: false }),
};

export function fallbackDailyTheme(template: DailyEventTemplate): DailyTheme {
  return {
    name: template.name,
    announcement: `${template.name}将在安全规则下举行，退出比赛的居民会进入观众席。`,
    source: 'fallback',
  };
}

export function buildDailyThemePrompt(template: DailyEventTemplate, dayKey: string): string {
  return [
    `日期：${dayKey}`,
    `固定模板：${template.name}`,
    `固定阶段：${template.stages.map((stage) => stage.label).join('、')}`,
    '只改编一个 2–20 字中文活动名和一句 10–80 字公告。',
    '不得改变阶段、淘汰、计分、时间或场地；不得出现死亡、受伤、处决或流血。',
    '只输出 JSON：{"name":"...","announcement":"..."}',
  ].join('\n');
}

export async function requestDailyTheme(
  template: DailyEventTemplate,
  dayKey: string,
  dependencies: ThemeDependencies = defaultDependencies,
): Promise<DailyTheme> {
  const fallback = fallbackDailyTheme(template);
  try {
    const config = dependencies.getConfig();
    if (config.provider !== 'ollama' || !isApprovedGemmaModel(config.chatModel)) {
      return fallback;
    }

    const response = await dependencies.complete({
      model: config.chatModel,
      messages: [{ role: 'user', content: buildDailyThemePrompt(template, dayKey) }],
      temperature: 0.5,
      max_tokens: 180,
      response_format: { type: 'json_object' },
      stream: false,
    });
    const parsed = JSON.parse(response.content) as {
      name?: unknown;
      announcement?: unknown;
    };
    if (typeof parsed.name !== 'string' || typeof parsed.announcement !== 'string') {
      return fallback;
    }

    const name = parsed.name.trim();
    const announcement = parsed.announcement.trim();
    if (!hasLengthWithin(name, 2, 20) || !hasLengthWithin(announcement, 10, 80)) {
      return fallback;
    }
    if (unsafeThemeText.test(`${name}\n${announcement}`)) return fallback;

    return { name, announcement, source: 'model' };
  } catch {
    return fallback;
  }
}

function hasLengthWithin(value: string, minimum: number, maximum: number): boolean {
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum;
}

function isApprovedGemmaModel(model: string): boolean {
  const normalized = model.trim().toLowerCase().split('/').at(-1);
  return normalized === 'gemma4:12b';
}
