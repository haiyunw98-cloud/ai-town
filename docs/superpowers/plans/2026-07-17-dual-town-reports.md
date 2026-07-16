# Dual Town Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add separate factual-ledger and medium-length social-observation Markdown exports, using bounded local Gemma analysis with a deterministic fallback, while presenting completed competitions only as history.

**Architecture:** Keep `buildDailyReport` as the factual source of truth. Add a focused client-side observation module that derives auditable metrics and fallback prose from the existing snapshot, plus one Convex action that may expand only a bounded digest with local Ollama. The UI exposes two adjacent export actions and never blocks the fallback download when the model fails.

**Tech Stack:** React, TypeScript, Convex actions, Ollama `gemma4:12b`, Jest, Markdown Blob downloads.

---

## File structure

- Create `src/components/socialObservationReport.ts`: pure fact extraction, bounded digest, fallback and final Markdown composition.
- Create `src/components/socialObservationReport.test.ts`: behavioral coverage for facts, boundaries, fallback and Markdown safety.
- Create `convex/socialObservations.ts`: local-only model prompt and Convex action.
- Create `convex/socialObservations.test.ts`: prompt and model-boundary tests with injected dependencies.
- Modify `src/components/EventBroadcast.tsx`: two-button UI, loading state and download flow.
- Modify `src/components/EventBroadcast.test.ts`: historical-event rendering contracts and export labels.
- Modify `src/components/eventBroadcastView.ts`: factual-ledger title, historical event wording and reusable exported date helpers.
- Modify `src/index.css`: compact two-action card and loading/disabled styles.
- Modify `src/i18n/index.ts`: replace the permanently misleading “赛事直播” tab label with “小镇观察”.
- Modify `README.md`: document both report types, local-only model use and fallback behavior.

### Task 1: Derive auditable social-observation facts

**Files:**
- Create: `src/components/socialObservationReport.ts`
- Create: `src/components/socialObservationReport.test.ts`
- Read: `src/components/eventBroadcastView.ts`
- Read: `data/worlds/lighthouse-town/lives.ts`
- Read: `data/worlds/lighthouse-town/map.ts`

- [ ] **Step 1: Write the failing fact-extraction tests**

```ts
import {
  buildSocialObservationDigest,
  buildSocialObservationFacts,
} from './socialObservationReport';
import type { BroadcastSnapshot } from './eventBroadcastView';

const now = Date.parse('2026-07-17T05:00:00Z'); // Shanghai 13:00

test('derives only same-day resident, observer, institution and interaction facts', () => {
  const snapshot = {
    event: null,
    participants: [],
    logs: [],
    conversations: [],
    residentActivity: [
      { residentId: 'p:lin', displayName: '林澜', status: '工作中', detail: '在灯塔书院整理记录' },
    ],
    dailyLifeEvents: [
      { residentId: 'p:lin', displayName: '林澜', kind: 'work', text: '在灯塔书院整理记录', createdAt: now - 2_000 },
    ],
    dailyMessages: [
      { messageId: 'm:1', conversationId: 'c:1', authorId: 'p:lin', authorName: '林澜', text: '我来核对。', createdAt: now - 1_000, observerIntervention: false },
      { messageId: 'm:2', conversationId: 'c:1', authorId: 'p:human', authorName: '苏萤', text: '请继续。', createdAt: now, observerIntervention: true },
    ],
  } satisfies BroadcastSnapshot;

  const facts = buildSocialObservationFacts(snapshot, 'zh-CN', now);

  expect(facts.dayKey).toBe('2026-07-17');
  expect(facts.observerInterventions).toBe(1);
  expect(facts.conversations).toEqual([
    { conversationId: 'c:1', participants: ['林澜', '观察者'], messageCount: 2 },
  ]);
  expect(facts.institutionUses).toContainEqual({ institution: '灯塔书院', count: 1 });
});

test('produces a bounded digest without yesterday records or model conclusions', () => {
  const digest = buildSocialObservationDigest({
    dayKey: '2026-07-17',
    generatedAt: now,
    recordRange: '12:59:58–13:00:00',
    residentCount: 9,
    messageCount: 2,
    lifeEventCount: 1,
    observerInterventions: 1,
    conversations: [{ conversationId: 'c:1', participants: ['林澜', '观察者'], messageCount: 2 }],
    residentFacts: [{ resident: '林澜', activities: ['在灯塔书院整理记录'], partners: ['观察者'], quotes: ['我来核对。'] }],
    institutionUses: [{ institution: '灯塔书院', count: 1 }],
    activityFacts: [],
    publicFacts: [],
  });

  expect(digest.length).toBeLessThanOrEqual(12_000);
  expect(digest).toContain('观察者介入：1');
  expect(digest).not.toContain('因此');
  expect(digest).not.toContain('证明');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- --runInBand src/components/socialObservationReport.test.ts`

Expected: FAIL because `socialObservationReport.ts` does not exist.

- [ ] **Step 3: Implement the typed fact model and bounded digest**

```ts
import type { Locale } from '../i18n';
import { townLandmarks } from '../../data/worlds/lighthouse-town/map';
import { residentLifeProfiles } from '../../data/worlds/lighthouse-town/lives';
import { shanghaiDayKey, type BroadcastSnapshot } from './eventBroadcastView';

export type SocialObservationFacts = {
  dayKey: string;
  generatedAt: number;
  recordRange: string;
  residentCount: number;
  messageCount: number;
  lifeEventCount: number;
  observerInterventions: number;
  conversations: Array<{ conversationId: string; participants: string[]; messageCount: number }>;
  residentFacts: Array<{ resident: string; activities: string[]; partners: string[]; quotes: string[] }>;
  institutionUses: Array<{ institution: string; count: number }>;
  activityFacts: string[];
  publicFacts: string[];
};

const sameShanghaiDay = (value: number, now: number) =>
  shanghaiDayKey(value) === shanghaiDayKey(now);

export function buildSocialObservationFacts(
  snapshot: BroadcastSnapshot,
  locale: Locale,
  now = Date.now(),
): SocialObservationFacts {
  const messages = snapshot.dailyMessages
    .filter((message) => sameShanghaiDay(message.createdAt, now))
    .sort((a, b) => a.createdAt - b.createdAt);
  const lifeEvents = (snapshot.dailyLifeEvents ?? [])
    .filter((event) => sameShanghaiDay(event.createdAt, now))
    .sort((a, b) => a.createdAt - b.createdAt);
  const grouped = new Map<string, typeof messages>();
  for (const message of messages) grouped.set(
    message.conversationId,
    [...(grouped.get(message.conversationId) ?? []), message],
  );
  const conversations = [...grouped].map(([conversationId, group]) => ({
    conversationId,
    participants: [...new Set(group.map((message) =>
      message.observerIntervention ? '观察者' : message.authorName,
    ))],
    messageCount: group.length,
  }));
  const residentFacts = residentLifeProfiles.map((profile) => {
    const ownMessages = messages.filter((message) =>
      !message.observerIntervention && message.authorName === profile.name,
    );
    const conversationIds = new Set(ownMessages.map((message) => message.conversationId));
    const partners = [...new Set(messages
      .filter((message) => conversationIds.has(message.conversationId))
      .map((message) => message.observerIntervention ? '观察者' : message.authorName)
      .filter((name) => name !== profile.name))];
    return {
      resident: profile.name,
      activities: lifeEvents.filter((event) => event.displayName === profile.name).map((event) => event.text),
      partners,
      quotes: ownMessages.slice(-3).map((message) => message.text.slice(0, 100)),
    };
  });
  const institutionUses = townLandmarks.map((landmark) => ({
    institution: landmark.name,
    count: lifeEvents.filter((event) => event.text.includes(landmark.name)).length,
  }));
  const timestamps = [...messages, ...lifeEvents].map((entry) => entry.createdAt);
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai',
  });
  return {
    dayKey: shanghaiDayKey(now), generatedAt: now,
    recordRange: timestamps.length ? `${formatter.format(Math.min(...timestamps))}–${formatter.format(Math.max(...timestamps))}` : '当日无记录',
    residentCount: residentLifeProfiles.length,
    messageCount: messages.length,
    lifeEventCount: lifeEvents.length,
    observerInterventions: messages.filter((message) => message.observerIntervention).length,
    conversations, residentFacts, institutionUses,
    activityFacts: snapshot.logs.filter((entry) => entry.kind !== 'conversation' && sameShanghaiDay(entry.createdAt, now)).map((entry) => entry.text),
    publicFacts: snapshot.logs.filter((entry) => entry.kind !== 'conversation' && sameShanghaiDay(entry.createdAt, now)).map((entry) => entry.text),
  };
}

export function buildSocialObservationDigest(facts: SocialObservationFacts) {
  const digest = JSON.stringify(facts);
  return digest.slice(0, 12_000);
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npm test -- --runInBand src/components/socialObservationReport.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the fact layer**

```bash
git add src/components/socialObservationReport.ts src/components/socialObservationReport.test.ts
git commit -m "feat: derive social observation facts"
```

### Task 2: Compose the deterministic social-observation Markdown

**Files:**
- Modify: `src/components/socialObservationReport.ts`
- Modify: `src/components/socialObservationReport.test.ts`

- [ ] **Step 1: Write failing report-composition tests**

```ts
import { buildSocialObservationReport } from './socialObservationReport';

const factsFixture = {
  dayKey: '2026-07-17',
  generatedAt: now,
  recordRange: '12:59:58–13:00:00',
  residentCount: 9,
  messageCount: 2,
  lifeEventCount: 1,
  observerInterventions: 1,
  conversations: [{ conversationId: 'c:1', participants: ['林澜', '观察者'], messageCount: 2 }],
  residentFacts: [{
    resident: '林澜', activities: ['在灯塔书院整理记录'],
    partners: ['观察者'], quotes: ['我来核对。'],
  }],
  institutionUses: [{ institution: '灯塔书院', count: 1 }],
  activityFacts: [],
  publicFacts: [],
};

test('builds all medium observation sections with an explicit fallback boundary', () => {
  const report = buildSocialObservationReport(factsFixture, {
    source: 'fallback',
    narrative: '',
  });
  for (const title of [
    '观察范围与数据覆盖', '当日社会结构概览', '居民互动网络与关系动向',
    '友情、亲密关系与合作迹象', '商业生活、劳动与机构使用',
    '公共生活、规范、分歧与协调', '观察者介入及其可见影响',
    '本地模型辅助的谨慎观察', '后续值得持续记录的线索', '方法与边界说明',
  ]) expect(report).toContain(`## ${title}`);
  expect(report).toContain('本次未使用模型扩写');
  expect(report).not.toContain('已经证明');
});

test('escapes model HTML and preserves the next Markdown section', () => {
  const report = buildSocialObservationReport(factsFixture, {
    source: 'model', narrative: '<script>alert(1)</script>\n## 伪造章节',
  });
  expect(report).not.toContain('<script>');
  expect(report).toContain('&lt;script&gt;');
  expect(report).toContain('## 方法与边界说明');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand src/components/socialObservationReport.test.ts`

Expected: FAIL because `buildSocialObservationReport` is not exported.

- [ ] **Step 3: Implement stable sections and safe narrative insertion**

```ts
export type SocialNarrative = { source: 'model' | 'fallback'; narrative: string };

const md = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\r\n|\r|\n/g, ' / ')
  .replace(/([\\`*_\[\]{}()#+\-.!|])/g, '\\$1')
  .trim();

export function buildSocialObservationReport(
  facts: SocialObservationFacts,
  result: SocialNarrative,
) {
  const lines = ['# 灯塔镇社会观察日志', '', `- 日期：${facts.dayKey}`, ''];
  const section = (title: string, values: string[]) =>
    lines.push(`## ${title}`, '', ...(values.length ? values : ['- 当日无记录']), '');
  section('观察范围与数据覆盖', [
    `- 记录范围：${facts.recordRange}`,
    `- 居民：${facts.residentCount} 人；消息：${facts.messageCount} 条；生活记录：${facts.lifeEventCount} 条`,
  ]);
  section('当日社会结构概览', facts.residentFacts.map((entry) =>
    `- ${md(entry.resident)}：活动 ${entry.activities.length} 条；互动伙伴 ${entry.partners.length} 人`,
  ));
  section('居民互动网络与关系动向', facts.conversations.map((entry) =>
    `- ${entry.participants.map(md).join(' × ')}：${entry.messageCount} 条消息`,
  ));
  section('友情、亲密关系与合作迹象', facts.residentFacts
    .filter((entry) => entry.partners.length)
    .map((entry) => `- ${md(entry.resident)}：当日可见伙伴 ${entry.partners.map(md).join('、')}`));
  section('商业生活、劳动与机构使用', facts.institutionUses
    .filter((entry) => entry.count)
    .map((entry) => `- ${md(entry.institution)}：确认使用 ${entry.count} 次`));
  section('公共生活、规范、分歧与协调', facts.publicFacts.map((value) => `- ${md(value)}`));
  section('观察者介入及其可见影响', [`- 观察者介入消息：${facts.observerInterventions} 条`]);
  section('本地模型辅助的谨慎观察', result.source === 'model' && result.narrative.trim()
    ? [`- ${md(result.narrative)}`]
    : ['- 本次未使用模型扩写；本节仅保留程序生成的事实统计。']);
  section('后续值得持续记录的线索', facts.residentFacts
    .filter((entry) => entry.partners.length || entry.activities.length)
    .slice(0, 9)
    .map((entry) => `- 继续记录 ${md(entry.resident)} 的活动与互动是否延续。`));
  section('方法与边界说明', [
    '- 本日志基于当日本地记录；人物设定不等于当日事实。',
    '- “可能”与“值得持续记录”不是因果结论，也不代表稳定人格。',
  ]);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --runInBand src/components/socialObservationReport.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit report composition**

```bash
git add src/components/socialObservationReport.ts src/components/socialObservationReport.test.ts
git commit -m "feat: compose factual social observation logs"
```

### Task 3: Add the local-only Gemma narrative boundary

**Files:**
- Create: `convex/socialObservations.ts`
- Create: `convex/socialObservations.test.ts`

- [ ] **Step 1: Write failing local-model boundary tests**

```ts
import { buildSocialObservationPrompt, requestSocialObservation } from './socialObservations';

test('bounds the digest and prohibits invention and causal conclusions', () => {
  const prompt = buildSocialObservationPrompt('x'.repeat(20_000));
  expect(prompt.length).toBeLessThan(14_000);
  expect(prompt).toContain('不得补写');
  expect(prompt).toContain('不得作因果定论');
});

test('uses Gemma through Ollama and returns a deterministic fallback for other providers', async () => {
  const complete = jest.fn(async () => ({ content: '记录显示，合作需要继续观察。' }));
  await expect(requestSocialObservation('事实', {
    getConfig: () => ({ provider: 'ollama', url: '', chatModel: 'gemma4:12b', embeddingModel: '', embeddingDimension: 1024, stopWords: [], apiKey: undefined }),
    complete,
  })).resolves.toEqual({ source: 'model', narrative: '记录显示，合作需要继续观察。' });
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemma4:12b' }));

  await expect(requestSocialObservation('事实', {
    getConfig: () => ({ provider: 'openai', url: '', chatModel: 'paid', embeddingModel: '', embeddingDimension: 1536, stopWords: [], apiKey: 'secret' }),
    complete,
  })).resolves.toEqual({ source: 'fallback', narrative: '' });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/socialObservations.test.ts`

Expected: FAIL because the model boundary does not exist.

- [ ] **Step 3: Implement the prompt, injected request and Convex action**

```ts
import { v } from 'convex/values';
import { action } from './_generated/server';
import { chatCompletion, getLLMConfig, type LLMConfig } from './util/llm';

type Dependencies = {
  getConfig: () => LLMConfig;
  complete: (body: Parameters<typeof chatCompletion>[0]) => Promise<{ content: string }>;
};

export function buildSocialObservationPrompt(digest: string) {
  return [
    '你是灯塔镇的谨慎社会观察记录员。',
    '只能依据下方事实摘要成文，不得补写人物、事件、关系、动机或地点。',
    '使用“记录显示”“可能”“尚需持续观察”；不得作心理诊断、价值评判或因果定论。',
    '输出 800–1400 个中文字符的连续观察文字，不添加新的 Markdown 标题。',
    digest.slice(0, 12_000),
  ].join('\n');
}

export async function requestSocialObservation(digest: string, dependencies: Dependencies = {
  getConfig: getLLMConfig,
  complete: (body) => chatCompletion({ ...body, stream: false }),
}) {
  const config = dependencies.getConfig();
  if (config.provider !== 'ollama') return { source: 'fallback' as const, narrative: '' };
  try {
    const result = await dependencies.complete({
      model: config.chatModel,
      messages: [{ role: 'user', content: buildSocialObservationPrompt(digest) }],
      max_tokens: 1600,
      temperature: 0.35,
      stream: false,
    });
    const narrative = result.content.trim().slice(0, 6_000);
    return narrative ? { source: 'model' as const, narrative } : { source: 'fallback' as const, narrative: '' };
  } catch {
    return { source: 'fallback' as const, narrative: '' };
  }
}

export const generate = action({
  args: { digest: v.string() },
  handler: async (_ctx, args) => requestSocialObservation(args.digest),
});
```

- [ ] **Step 4: Run focused tests and type-check**

Run: `npm test -- --runInBand convex/socialObservations.test.ts && npx tsc --noEmit`

Expected: PASS with no type errors.

- [ ] **Step 5: Commit the local model boundary**

```bash
git add convex/socialObservations.ts convex/socialObservations.test.ts convex/_generated/api.d.ts
git commit -m "feat: generate social observations with local Gemma"
```

### Task 4: Expose two compact report actions

**Files:**
- Modify: `src/components/EventBroadcast.tsx`
- Modify: `src/components/EventBroadcast.test.ts`
- Modify: `src/components/eventBroadcastView.ts`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing UI contract tests**

```ts
test('offers separate factual and social report exports', () => {
  const source = readFileSync(new URL('./EventBroadcast.tsx', import.meta.url), 'utf8');
  expect(source).toContain('导出事实流水账');
  expect(source).toContain('生成社会观察日志');
  expect(source).toContain('正在整理社会观察');
  expect(source).toContain('灯塔镇事实流水账-');
  expect(source).toContain('灯塔镇社会观察日志-');
  expect(source).toContain('useAction(api.socialObservations.generate)');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts`

Expected: FAIL because the second action and new filenames are absent.

- [ ] **Step 3: Implement the dual export flow**

```tsx
const generateSocialObservation = useAction(api.socialObservations.generate);
const [socialReportPending, setSocialReportPending] = useState(false);

const downloadMarkdown = (body: string, filename: string) => {
  const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const exportFacts = () => {
  const exportNow = Date.now();
  downloadMarkdown(
    buildDailyReport(snapshot, locale, exportNow),
    `灯塔镇事实流水账-${shanghaiDayKey(exportNow)}.md`,
  );
};

const exportSocialObservation = async () => {
  if (socialReportPending) return;
  const exportNow = Date.now();
  const facts = buildSocialObservationFacts(snapshot, locale, exportNow);
  setSocialReportPending(true);
  let result: SocialNarrative = { source: 'fallback', narrative: '' };
  try {
    result = await generateSocialObservation({ digest: buildSocialObservationDigest(facts) });
  } catch {
    result = { source: 'fallback', narrative: '' };
  } finally {
    downloadMarkdown(
      buildSocialObservationReport(facts, result),
      `灯塔镇社会观察日志-${shanghaiDayKey(exportNow)}.md`,
    );
    setSocialReportPending(false);
  }
};
```

Render both buttons inside `.daily-report-actions`; disable only the social button while pending and use the exact loading label from the test.

- [ ] **Step 4: Add compact styles and run tests**

```css
.daily-report-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.daily-report-actions button[disabled] { cursor: wait; filter: saturate(.6); opacity: .75; }
```

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts src/components/socialObservationReport.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit the dual-button UI**

```bash
git add src/components/EventBroadcast.tsx src/components/EventBroadcast.test.ts src/components/eventBroadcastView.ts src/index.css
git commit -m "feat: export factual and social town reports"
```

### Task 5: Make completed competitions historical-only

**Files:**
- Modify: `src/components/EventBroadcast.tsx`
- Modify: `src/components/EventBroadcast.test.ts`
- Modify: `src/i18n/index.ts`
- Modify: `src/components/eventBroadcastView.ts`

- [ ] **Step 1: Write a failing completed-event view test**

```ts
test('completed competition is historical and has no live ranking language', () => {
  const view = buildBroadcastView({
    ...running,
    event: { ...running.event!, status: 'completed', phase: 'awards', winnerId: 'p:1' },
  }, 'zh-CN', Date.now());
  expect(view.mode).toBe('event');
  expect(view.title).toBe('往届赛事记录');

  const source = readFileSync(new URL('./EventBroadcast.tsx', import.meta.url), 'utf8');
  expect(source).toContain('!eventCompleted &&');
  expect(source).toContain('往届赛事记录');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts`

Expected: FAIL because the completed view still derives the live title and renders the scoreboard subtree.

- [ ] **Step 3: Implement strict active/history branches**

In `buildBroadcastView`, return `title: '往届赛事记录'` for `status === 'completed'`. In `EventBroadcast.tsx`, render the scoreboard, countdown, active roles and remaining count only inside `!eventCompleted`; render the completed branch as a history card containing name, champion, prize, result and ordered logs. Change the observer tab translation from `赛事直播` to `小镇观察` so a completed event is never advertised as live.

- [ ] **Step 4: Run focused and full tests**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts && npm test -- --runInBand`

Expected: all suites PASS.

- [ ] **Step 5: Commit the historical presentation**

```bash
git add src/components/EventBroadcast.tsx src/components/EventBroadcast.test.ts src/components/eventBroadcastView.ts src/i18n/index.ts
git commit -m "fix: present completed town competitions as history"
```

### Task 6: Document and verify the dual-report release

**Files:**
- Modify: `README.md`
- Test: all report and world tests

- [ ] **Step 1: Document the two reports and model boundary**

Add a `双日报` section describing the two filenames, ten social-observation sections, local Gemma-only expansion, deterministic fallback, Shanghai date and the distinction between facts and cautious observation.

- [ ] **Step 2: Run final verification**

Run:

```bash
npm test -- --runInBand
npx tsc --noEmit
npm run validate:world
npm run build
./scripts/check-lighthouse-site.sh
git diff --check
```

Expected: all tests pass; production build and client-boundary validation pass; world assets validate; `frontend=200 backend=tcp-open`; no whitespace errors.

- [ ] **Step 3: Browser acceptance**

Open `http://localhost:5173/ai-town`, verify both report buttons are visible in one compact card, click the factual export, click the social export, confirm the loading label appears and the page records no console errors. For a completed event, confirm no live countdown, remaining count or ranking is present.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain dual town reports"
```
