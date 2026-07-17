# Jiangnan Conversation Realism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mystery-driven resident speech and observer summaries with short, varied, auditable Jiangnan daily-life conversations while preserving old records as history only.

**Architecture:** Put world semantics, topic selection, memory filtering and reply validation in pure TypeScript modules. Conversation actions consume one recorded daily topic and filtered memories, while the send boundary validates every final model reply. Existing messages remain untouched; current summaries classify only post-policy daily-life content.

**Tech Stack:** TypeScript, Convex actions/mutations/queries, local Ollama `gemma4:12b`, Jest, React.

---

## File structure

- Modify `data/worlds/lighthouse-town/manifest.ts`, `characters.ts`, `activities.ts`, `lives.ts`, `map.ts`: canonical inland-Jiangnan setting and ordinary jobs/lives.
- Modify existing content/activity/life/world-art tests: reject marine mystery wording from runtime fields.
- Create `convex/agent/conversationPolicy.ts` and `.test.ts`: topic budget, legacy-memory filter, observer correction and bounded replies.
- Modify `convex/schema.ts`: auditable `conversationTopics` records.
- Modify `convex/agent/conversation.ts`: select and record a topic, build short-turn prompts and filter legacy memories.
- Modify `convex/agent/memory.ts`: daily-life memory summaries and legacy filtering.
- Modify `convex/aiTown/agentOperations.ts`: final reply validation before persistence.
- Create `convex/agent/conversationPolicy.integration.test.ts`: prompt/send boundary contracts.
- Modify `convex/events.ts`, `src/components/eventBroadcastView.ts`, `EventBroadcast.test.ts`: ordinary-life summary taxonomy and legacy suppression.

### Task 1: Rewrite every runtime world source as inland Jiangnan daily life

**Files:**
- Modify: `data/worlds/lighthouse-town/manifest.ts`
- Modify: `data/worlds/lighthouse-town/characters.ts`
- Modify: `data/worlds/lighthouse-town/activities.ts`
- Modify: `data/worlds/lighthouse-town/lives.ts`
- Modify: `data/worlds/lighthouse-town/map.ts`
- Test: `data/worlds/lighthouse-town/content.test.ts`
- Test: `data/worlds/lighthouse-town/activities.test.ts`
- Test: `data/worlds/lighthouse-town/lives.test.ts`
- Test: `src/components/worldArt.test.ts`

- [ ] **Step 1: Add failing runtime-language tests**

```ts
const forbiddenRuntimeStory = /海潮|潮汐|航标|海风|海浪|夜航|无海航路|异常闪光|灯塔谜|机关谜|线索交汇/u;

test('keeps all runtime resident content in ordinary inland Jiangnan life', () => {
  const runtime = JSON.stringify({
    descriptions: localizedDescriptions('zh-CN'),
    activities: residentActivities,
    lives: residentLifeProfiles,
    landmarks: townLandmarks,
    world: buildWorldPrompt('zh-CN'),
  });
  expect(runtime).toContain('江南内陆');
  expect(runtime).toContain('镇上没有海');
  expect(runtime).not.toMatch(forbiddenRuntimeStory);
});

test('keeps clues in archives but out of localized runtime identities', () => {
  expect(lighthouseCharacters.some((entry) => entry.clue['zh-CN'].length > 0)).toBe(true);
  expect(JSON.stringify(localizedDescriptions('zh-CN'))).not.toContain('无海航路');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand data/worlds/lighthouse-town/content.test.ts data/worlds/lighthouse-town/activities.test.ts data/worlds/lighthouse-town/lives.test.ts src/components/worldArt.test.ts`

Expected: FAIL on existing maritime/mystery wording.

- [ ] **Step 3: Rewrite the data sources**

Use these exact setting rules in `manifest.ts` and apply them to every runtime field:

```ts
const worldRules = [
  '灯塔镇是江南内陆水乡，镇上没有海。',
  '镇中心高塔只是历史地标，不承担航海、航标、观潮或海防功能。',
  '居民主要谈工作、收入、买卖、吃饭、衣物、健康、友情、感情和公共生活。',
  '自主谈话不得发起灯塔谜团、异常调查或海洋叙事。',
  '观察者若问海洋，应先简短说明“镇上没有海，这座塔只是地标”。',
];
```

Keep the nine existing names and professions, but rewrite every `identity`, `plan`, `relationshipHook`, activity description, business/currentGoal/recentHighlight and landmark description that violates the tests. Remove `character.clue` from the array joined by `localizedDescriptions`; do not delete the archive field itself.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --runInBand data/worlds/lighthouse-town/content.test.ts data/worlds/lighthouse-town/activities.test.ts data/worlds/lighthouse-town/lives.test.ts src/components/worldArt.test.ts`

Expected: PASS with nine residents and nine usable institutions.

- [ ] **Step 5: Commit world-source cleanup**

```bash
git add data/worlds/lighthouse-town src/components/worldArt.test.ts
git commit -m "fix: ground lighthouse town in daily Jiangnan life"
```

### Task 2: Implement an auditable daily topic policy and reply validator

**Files:**
- Create: `convex/agent/conversationPolicy.ts`
- Create: `convex/agent/conversationPolicy.test.ts`

- [ ] **Step 1: Write failing policy tests**

```ts
import {
  filterLegacyMemories,
  selectConversationTopic,
  validateResidentReply,
} from './conversationPolicy';

test('selects only daily-life topics and does not repeat the last detail', () => {
  const chosen = selectConversationTopic(
    '2026-07-17:p:1:c:9', ['meal', 'meal', 'work'],
    { livelihood: 6, relationship: 2, 'public-life': 1 },
  );
  expect(['livelihood', 'relationship', 'public-life']).toContain(chosen.category);
  expect(chosen.detail).not.toBe('meal');
});

test('holds the rolling 60/25/15 topic budget over 100 selections', () => {
  const counts = { livelihood: 0, relationship: 0, 'public-life': 0 };
  for (let index = 0; index < 100; index += 1) {
    const topic = selectConversationTopic(`seed:${index}`, [], counts);
    counts[topic.category] += 1;
  }
  expect(counts).toEqual({ livelihood: 60, relationship: 25, 'public-life': 15 });
});

test('filters old mystery memories without mutating the source', () => {
  const memories = [
    { description: '我记得灯塔异常闪光和失落航路。' },
    { description: '我和唐果谈了茶馆淡季生意。' },
  ] as any[];
  expect(filterLegacyMemories(memories).map((entry) => entry.description)).toEqual([
    '我和唐果谈了茶馆淡季生意。',
  ]);
  expect(memories).toHaveLength(2);
});

test('bounds ordinary replies and corrects an observer sea question', () => {
  expect(validateResidentReply('（我望向海潮）今晚航标有异。', {
    kind: 'continue', topic: 'meal', observerAskedAboutSea: false,
  })).toMatchObject({ accepted: false, text: expect.not.stringMatching(/海潮|航标/u) });
  expect(validateResidentReply('这里能观海吗？', {
    kind: 'continue', topic: 'meal', observerAskedAboutSea: true,
  }).text).toContain('镇上没有海，这座塔只是地标');
  expect(Array.from(validateResidentReply('今天茶馆新到了一批龙井，要不要一起尝尝？', {
    kind: 'continue', topic: 'meal', observerAskedAboutSea: false,
  }).text).length).toBeLessThanOrEqual(60);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/agent/conversationPolicy.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement deterministic policy helpers**

```ts
export type TopicCategory = 'livelihood' | 'relationship' | 'public-life';
export type ConversationTopic = { category: TopicCategory; detail: string };

const topics: Record<TopicCategory, string[]> = {
  livelihood: ['work', 'order', 'income', 'shopping', 'meal', 'clothing', 'home', 'rest', 'health'],
  relationship: ['friendship', 'care', 'date', 'misunderstanding', 'cooperation', 'neighbor-help'],
  'public-life': ['market', 'class', 'festival', 'institution', 'local-news', 'safety'],
};
const legacy = /海面|海潮|潮汐|观潮|航标|海风|海浪|夜航|失落航路|无海航路|异常闪光|灯塔谜|机关谜|线索交汇/u;
const stageDirection = /（[^）]*）|\([^)]*\)/gu;

function hash(value: string) {
  let result = 0;
  for (const character of value) result = (Math.imul(result, 31) + character.charCodeAt(0)) | 0;
  return Math.abs(result);
}

export function selectConversationTopic(
  seed: string,
  recent: string[],
  counts: Record<TopicCategory, number>,
): ConversationTopic {
  const nextTotal = Object.values(counts).reduce((sum, value) => sum + value, 0) + 1;
  const targets: Record<TopicCategory, number> = {
    livelihood: 0.60, relationship: 0.25, 'public-life': 0.15,
  };
  const category = (Object.keys(targets) as TopicCategory[])
    .sort((left, right) =>
      (targets[right] * nextTotal - counts[right]) - (targets[left] * nextTotal - counts[left])
      || hash(`${seed}:${left}`) - hash(`${seed}:${right}`),
    )[0];
  const candidates = topics[category].filter((detail) => !recent.slice(-3).includes(detail));
  const pool = candidates.length ? candidates : topics[category];
  return { category, detail: pool[hash(`${seed}:detail`) % pool.length] };
}

export function filterLegacyMemories<T extends { description: string }>(memories: readonly T[]) {
  return memories.filter((memory) => !legacy.test(memory.description));
}

export function validateResidentReply(raw: string, context: {
  kind: 'start' | 'continue' | 'leave'; topic: string; observerAskedAboutSea: boolean;
}) {
  if (context.observerAskedAboutSea) {
    return { accepted: false, reason: 'world-correction' as const, text: '镇上没有海，这座塔只是地标。你想问的是镇里的哪件事？' };
  }
  const limit = context.kind === 'start' ? 45 : context.kind === 'leave' ? 35 : 60;
  const cleaned = raw.replace(stageDirection, ' ').replace(/\s+/gu, ' ').trim();
  if (!cleaned || legacy.test(cleaned)) {
    const fallback = context.kind === 'leave' ? '我先去忙手头的事，晚些再聊。' : '你今天过得怎么样？我刚好也想歇一会儿。';
    return { accepted: false, reason: !cleaned ? 'empty' as const : 'legacy-story' as const, text: fallback };
  }
  const sentence = cleaned.split(/(?<=[。！？!?])/u)[0] || cleaned;
  const text = Array.from(sentence).slice(0, limit).join('').replace(/[，、：；]$/u, '。');
  return { accepted: true, text };
}
```

- [ ] **Step 4: Run policy tests and verify GREEN**

Run: `npm test -- --runInBand convex/agent/conversationPolicy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the policy module**

```bash
git add convex/agent/conversationPolicy.ts convex/agent/conversationPolicy.test.ts
git commit -m "feat: enforce ordinary resident conversation policy"
```

### Task 3: Persist selected topics and integrate short-turn prompts

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/agent/conversation.ts`
- Create: `convex/agent/conversationPolicy.integration.test.ts`

- [ ] **Step 1: Write failing integration contracts**

```ts
test('conversation source records one topic and locks short daily-life prompts', () => {
  const source = readFileSync('convex/agent/conversation.ts', 'utf8');
  expect(source).toContain('recordConversationTopic');
  expect(source).toContain('filterLegacyMemories');
  expect(source).toContain('20–60 个中文字符');
  expect(source).toContain('每轮只推进一个意思');
  expect(source).toContain('不要使用括号舞台说明');
});

test('schema stores auditable topic selections', () => {
  const source = readFileSync('convex/schema.ts', 'utf8');
  expect(source).toContain('conversationTopics: defineTable');
  expect(source).toContain("v.union(v.literal('livelihood')");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/agent/conversationPolicy.integration.test.ts`

Expected: FAIL because topic persistence is absent.

- [ ] **Step 3: Add the table and internal helpers**

Add this table to `convex/schema.ts`:

```ts
conversationTopics: defineTable({
  worldId: v.id('worlds'),
  playerId,
  conversationId,
  category: v.union(v.literal('livelihood'), v.literal('relationship'), v.literal('public-life')),
  detail: v.string(),
  selectedAt: v.number(),
}).index('residentTime', ['worldId', 'playerId', 'selectedAt']),
```

In `conversation.ts`, query the last three topic details and the current Shanghai day's category counts, call `selectConversationTopic`, persist it once per conversation, filter retrieved memories, and add these exact rules to every start/continue/leave prompt:

```ts
`本轮日常话题：${topic.detail}。`,
'用自然的简体中文交谈，每轮只推进一个意思。',
'普通回复控制在 20–60 个中文字符；开场 15–45 字；告别 10–35 字。',
'不要使用括号舞台说明，不要长篇描写动作、环境或内心。',
'不要发起异变、谜团、调查、灯塔机关或海洋话题。',
```

Use `otherPlayer.human` and the latest human message to calculate `observerAskedAboutSea` with `/海|航标|观潮|潮汐/u`.

- [ ] **Step 4: Run integration and policy tests**

Run: `npm test -- --runInBand convex/agent/conversationPolicy.integration.test.ts convex/agent/conversationPolicy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit topic persistence and prompts**

```bash
git add convex/schema.ts convex/agent/conversation.ts convex/agent/conversationPolicy.integration.test.ts
git commit -m "feat: record daily topics and shorten resident turns"
```

### Task 4: Validate the final send boundary and isolate legacy memories

**Files:**
- Modify: `convex/aiTown/agentOperations.ts`
- Modify: `convex/agent/memory.ts`
- Modify: `convex/agent/conversationPolicy.integration.test.ts`

- [ ] **Step 1: Add failing send and memory tests**

```ts
test('validates the final generated text before agentSendMessage', () => {
  const source = readFileSync('convex/aiTown/agentOperations.ts', 'utf8');
  expect(source).toMatch(/validateResidentReply[\s\S]*agentSendMessage/u);
});

test('memory summaries explicitly preserve daily life and suppress legacy mystery amplification', () => {
  const source = readFileSync('convex/agent/memory.ts', 'utf8');
  expect(source).toContain('只总结实际谈到的日常生活');
  expect(source).toContain('filterLegacyMemories');
  expect(source).not.toContain('add if you liked or disliked this interaction');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/agent/conversationPolicy.integration.test.ts`

Expected: FAIL on the send and memory contracts.

- [ ] **Step 3: Integrate the final validator and memory policy**

Validate `completionFn` output in `agentGenerateMessage` immediately before `agentSendMessage`. Pass the message kind, recorded topic and observer question flag; record only the enum reason in logs, never rejected text.

Change the memory system prompt to:

```ts
'用第一人称简体中文，只总结实际谈到的日常生活、承诺、交易、帮助或分歧。控制在 80 个中文字符以内。不要增加海洋、灯塔谜团、异变、心理诊断或未说出口的感情。'
```

Apply `filterLegacyMemories` after retrieval and before reflection/prompt construction. Preserve all database rows.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --runInBand convex/agent/conversationPolicy.integration.test.ts convex/agent/conversationPolicy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit send and memory guards**

```bash
git add convex/aiTown/agentOperations.ts convex/agent/memory.ts convex/agent/conversationPolicy.integration.test.ts
git commit -m "fix: keep legacy mysteries out of new resident speech"
```

### Task 5: Replace the observer fast summary with ordinary-life taxonomy

**Files:**
- Modify: `convex/events.ts`
- Modify: `src/components/eventBroadcastView.ts`
- Modify: `src/components/EventBroadcast.test.ts`

- [ ] **Step 1: Add failing observer-summary tests**

```ts
test('does not resurrect legacy mystery framing in the live observer summary', () => {
  const summary = summarizeConversation(['顾潮', '白露'], [
    '旧记录提到灯火装置与河道线索。',
    '今天药庐配了三份常用药，食肆准备了午饭。',
  ]);
  expect(summary).toContain('药庐');
  expect(summary).not.toMatch(/异变|线索交汇|灯火装置|河道水位|花木生长|机关结构/u);
});

test('shows an honest empty state when only legacy content exists', () => {
  expect(summarizeConversation(['顾潮'], ['灯塔异常闪光。'])).toBe('暂无新的日常记录');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts`

Expected: FAIL on the hard-coded mystery taxonomy.

- [ ] **Step 3: Implement daily-life classification**

Export `summarizeConversation` and classify only these groups:

```ts
const dailyTopicLabels = [
  ['劳动', /工作|上课|备课|修理|送货|坐诊/u],
  ['商业', /买|卖|订单|工资|采购|账目|生意/u],
  ['饮食', /吃|饭|茶|点心|粥|面/u],
  ['照护', /照顾|看病|休息|健康/u],
  ['友情与关系', /朋友|约会|关心|误会|合作|邻里/u],
  ['公共生活', /集市|书院|药庐|茶庄|镇公所|食肆/u],
] as const;
```

Remove all fixed “小镇异变” headings. Use `今日灯塔镇` as the heading and `暂无新的日常记录` when every message is legacy-filtered.

- [ ] **Step 4: Run UI tests and build**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts && npm run build`

Expected: PASS and successful client-boundary validation.

- [ ] **Step 5: Commit observer summary cleanup**

```bash
git add convex/events.ts src/components/eventBroadcastView.ts src/components/EventBroadcast.test.ts
git commit -m "fix: summarize ordinary town life in observer view"
```

### Task 6: Verify behavior against fixed samples and live local Gemma

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run all focused tests**

Run: `npm test -- --runInBand data/worlds/lighthouse-town/content.test.ts data/worlds/lighthouse-town/activities.test.ts data/worlds/lighthouse-town/lives.test.ts convex/agent/conversationPolicy.test.ts convex/agent/conversationPolicy.integration.test.ts src/components/EventBroadcast.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run: `npm test -- --runInBand && npm run build && npm run validate:world`

Expected: all tests, TypeScript, Vite build, bundle privacy check and world assets pass.

- [ ] **Step 3: Verify the 100-topic deterministic distribution test**

Run: `npm test -- --runInBand convex/agent/conversationPolicy.test.ts -t "60/25/15"`

Expected: PASS with exactly 60 livelihood, 25 relationship and 15 public-life selections, zero mystery topics.

- [ ] **Step 4: Update README**

Document inland-Jiangnan semantics, short-turn limits, topic distribution, historical-memory preservation and the observer correction for sea questions.

- [ ] **Step 5: Commit verification documentation**

```bash
git add README.md
git commit -m "docs: explain realistic resident conversation rules"
```
