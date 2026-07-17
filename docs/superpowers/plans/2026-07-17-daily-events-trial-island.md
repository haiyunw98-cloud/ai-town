# Daily Events and Trial Island Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run one safe, visible town activity every Shanghai day from 12:00–14:00, using main-town or Trial Island venues, then archive it and restore every resident to normal life while preserving complete factual and social-observation records.

**Architecture:** Extend the existing event tables with backward-compatible daily-event fields, replace the one-off challenge assumptions with template-driven scheduling and a deterministic state machine, and keep all residents in one expanded world map. Main-town and island regions share the current engine; a controlled ferry transfer bridges their disconnected walkable areas, while Pixi overlays render temporary props and stage state.

**Tech Stack:** Convex cron/mutations/actions, TypeScript state machines, existing AI Town movement engine, React + PixiJS, local Ollama Gemma, Jest, generated WebP map art.

**Prerequisite:** Execute `2026-07-17-dual-town-reports.md` and `2026-07-17-basic-economy-social-work.md` first. Daily prizes use the shared economy ledger and Task 10 extends the report modules created by the dual-report plan.

---

## File structure

- Create `convex/events/dailySchedule.ts` and `.test.ts`: Shanghai window, day key, catch-up stage and seven-day rotation.
- Create `convex/events/dailyTemplates.ts` and `.test.ts`: seven fixed safe templates and venue/checkpoint metadata.
- Create `convex/events/dailyTheme.ts` and `.test.ts`: bounded local Gemma theme generation with deterministic fallback.
- Modify `convex/events/model.ts` and `.test.ts`: reuse the existing local-only finite-choice resident decision boundary for daily stages.
- Create `convex/events/dailyStateMachine.ts` and `.test.ts`: idempotent two-hour phase progression, scoring, spectating and archive result.
- Modify `convex/schema.ts`: optional daily-event fields and world/day index, preserving old records.
- Modify `convex/events.ts`: exactly-once daily creation, catch-up, pause handling, progression, movement, logging and history snapshot.
- Modify `convex/townEconomy.ts`: idempotent 10/20/50 金贝 participation, finalist and champion rewards plus host-institution service income.
- Modify `convex/crons.ts`: rename the generic activity advance job while keeping the 30-second cadence.
- Modify `convex/aiTown/agentInputs.ts`: controlled ferry transfer input.
- Modify `data/worlds/lighthouse-town/map.ts`: expanded main-town plus Trial Island map and checkpoints.
- Modify `data/worlds/lighthouse-town/map.test.ts` or `src/components/worldArt.test.ts`: geometry and asset contracts.
- Create `public/assets/worlds/lighthouse-town/trial-island-v1.webp`: the new water-and-island segment; the existing town image remains byte-for-byte unchanged.
- Modify `public/assets/worlds/lighthouse-town/asset-sources.md`: asset provenance and prompt.
- Create `src/components/EventMapOverlay.tsx` and `.test.ts`: temporary routes, zones, props, team and stage markers.
- Create `src/components/MapRegionControls.tsx` and `.test.ts`: main town, island, panorama and follow-event controls.
- Modify `src/components/PixiStaticMap.tsx`, `PixiGame.tsx`, `PixiViewport.tsx`, `Game.tsx`, `worldArt.ts`, `worldArt.test.ts`: stitch, render and navigate the expanded world.
- Modify `src/components/EventBroadcast.tsx`, `EventBroadcast.test.ts`, `eventBroadcastView.ts`: active daily activity versus historical records.
- Modify `src/components/socialObservationReport.ts` and tests: activity-focused observations.
- Modify `README.md`: schedule, safety, maps, history and pause behavior.

### Task 1: Define the Shanghai schedule and seven-template rotation

**Files:**
- Create: `convex/events/dailySchedule.ts`
- Create: `convex/events/dailySchedule.test.ts`

- [ ] **Step 1: Write failing schedule tests**

```ts
import {
  dailyEventWindow,
  selectDailyTemplate,
  shanghaiEventDayKey,
} from './dailySchedule';

test('uses the exact Shanghai 12:00–14:00 window', () => {
  expect(dailyEventWindow(Date.parse('2026-07-17T03:59:59Z')).state).toBe('before');
  expect(dailyEventWindow(Date.parse('2026-07-17T04:00:00Z'))).toMatchObject({ state: 'live', stageIndex: 0 });
  expect(dailyEventWindow(Date.parse('2026-07-17T05:15:00Z'))).toMatchObject({ state: 'live', stageIndex: 4 });
  expect(dailyEventWindow(Date.parse('2026-07-17T06:00:00Z')).state).toBe('after');
  expect(shanghaiEventDayKey(Date.parse('2026-07-17T04:00:00Z'))).toBe('2026-07-17');
});

test('does not repeat a template used in the previous six days', () => {
  const previous = ['safe-survival', 'town-relay', 'island-resources', 'market-business', 'community-service', 'cooking-craft'];
  expect(selectDailyTemplate('2026-07-17', previous)).toBe('relay-build');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/events/dailySchedule.test.ts`

Expected: FAIL because the schedule module is absent.

- [ ] **Step 3: Implement exact stage boundaries and deterministic selection**

```ts
export const DAILY_TEMPLATE_IDS = [
  'safe-survival', 'town-relay', 'island-resources', 'market-business',
  'community-service', 'cooking-craft', 'relay-build',
] as const;
export type DailyTemplateId = typeof DAILY_TEMPLATE_IDS[number];

const stageMinutes = [0, 10, 35, 60, 70, 90, 110, 120] as const;

export function shanghaiEventDayKey(timestamp: number) {
  const date = new Date(timestamp + 8 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function dailyEventWindow(timestamp: number) {
  const shifted = new Date(timestamp + 8 * 60 * 60 * 1000);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  if (minutes < 720) return { state: 'before' as const, stageIndex: -1 };
  if (minutes >= 840) return { state: 'after' as const, stageIndex: 7 };
  const elapsed = minutes - 720;
  const stageIndex = stageMinutes.findIndex((value, index) =>
    elapsed >= value && elapsed < stageMinutes[index + 1],
  );
  return { state: 'live' as const, stageIndex, elapsedMinutes: elapsed };
}

export function selectDailyTemplate(dayKey: string, previous: string[]): DailyTemplateId {
  const excluded = new Set(previous.slice(-6));
  const available = DAILY_TEMPLATE_IDS.filter((id) => !excluded.has(id));
  const pool = available.length ? available : DAILY_TEMPLATE_IDS;
  let hash = 0;
  for (const character of dayKey) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return pool[Math.abs(hash) % pool.length];
}

export type WorldRunStatus = 'running' | 'inactive' | 'stoppedByDeveloper';
export type DailyEventAction =
  | { kind: 'none' }
  | { kind: 'create' | 'advance'; stageIndex: number }
  | { kind: 'archive'; stageIndex: 6 }
  | { kind: 'archive-paused' }
  | { kind: 'record-missed' };

export function dailyEventAction(
  timestamp: number,
  worldStatus: WorldRunStatus,
  existing: { status: 'running' | 'completed'; stageIndex: number } | null,
): DailyEventAction {
  const window = dailyEventWindow(timestamp);
  if (window.state === 'before' || existing?.status === 'completed') return { kind: 'none' };
  if (window.state === 'live') {
    if (worldStatus !== 'running') return { kind: 'none' };
    if (!existing) return { kind: 'create', stageIndex: window.stageIndex };
    return existing.stageIndex < window.stageIndex
      ? { kind: 'advance', stageIndex: window.stageIndex }
      : { kind: 'none' };
  }
  if (!existing) return { kind: 'record-missed' };
  if (worldStatus !== 'running') return { kind: 'archive-paused' };
  return { kind: 'archive', stageIndex: 6 };
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --runInBand convex/events/dailySchedule.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit scheduling**

```bash
git add convex/events/dailySchedule.ts convex/events/dailySchedule.test.ts
git commit -m "feat: schedule one daily Shanghai event"
```

### Task 2: Define seven safe activity templates

**Files:**
- Create: `convex/events/dailyTemplates.ts`
- Create: `convex/events/dailyTemplates.test.ts`

- [ ] **Step 1: Write failing template safety tests**

```ts
import { dailyEventTemplates } from './dailyTemplates';

test('defines seven complete safe templates with fixed two-hour stages', () => {
  expect(dailyEventTemplates).toHaveLength(7);
  expect(new Set(dailyEventTemplates.map((entry) => entry.id)).size).toBe(7);
  for (const template of dailyEventTemplates) {
    expect(template.stages.map((stage) => stage.endsAtMinute)).toEqual([10, 35, 60, 70, 90, 110, 120]);
    expect(template.stages.every((stage) => stage.checkpoints.length > 0)).toBe(true);
    expect(template.teamCount).toBe(2);
    expect(JSON.stringify(template)).not.toMatch(/死亡|受伤|血|处决/);
    expect(template.eliminationResult).toBe('spectator');
  }
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/events/dailyTemplates.test.ts`

Expected: FAIL because template definitions are missing.

- [ ] **Step 3: Implement the template contract and all seven entries**

```ts
import type { DailyTemplateId } from './dailySchedule';

export type VenueMode = 'main-town' | 'trial-island';
export type DailyStageId = 'assembly' | 'round-one' | 'round-two' | 'break' | 'semifinal' | 'final' | 'awards';
export type DailyEventTemplate = {
  id: DailyTemplateId;
  name: string;
  venue: VenueMode;
  teamCount: 2;
  eliminationResult: 'spectator';
  stages: Array<{
    id: DailyStageId;
    label: string;
    endsAtMinute: number;
    targetActive: number;
    checkpoints: string[];
    props: string[];
    choices: Array<{ id: string; label: string }>;
  }>;
};

const stageIds: DailyStageId[] = ['assembly', 'round-one', 'round-two', 'break', 'semifinal', 'final', 'awards'];
const ends = [10, 35, 60, 70, 90, 110, 120];
const active = [9, 8, 6, 6, 4, 1, 1];
const choices = [
  [{ id: 'encourage', label: '鼓励同伴' }, { id: 'observe', label: '观察规则' }],
  [{ id: 'steady', label: '稳步完成' }, { id: 'sprint', label: '快速尝试' }],
  [{ id: 'lead', label: '主动带队' }, { id: 'follow', label: '配合同伴' }],
  [{ id: 'share', label: '分享信息' }, { id: 'keep', label: '保留信息' }],
  [{ id: 'coordinate', label: '协调团队' }, { id: 'focus', label: '专注任务' }],
  [{ id: 'steady', label: '稳健完成' }, { id: 'risk', label: '争取领先' }],
  [{ id: 'thank', label: '感谢同伴' }, { id: 'reflect', label: '回顾过程' }],
];

const configurations: Array<{
  id: DailyTemplateId; name: string; venue: VenueMode;
  labels: string[]; checkpoints: string[]; props: string[];
}> = [
  { id: 'safe-survival', name: '试炼岛安全协作挑战', venue: 'trial-island', labels: ['码头集合与登船', '木头人安全赛道', '发光踏板桥', '庭院休整与交换', '团队拔河', '终点冲刺', '颁奖与返程'], checkpoints: ['old-dock', 'island-track', 'island-bridge', 'island-courtyard', 'island-team-field', 'island-final', 'island-awards'], props: ['ferry', 'stop-light', 'light-tiles', 'water-table', 'rope', 'finish-line', 'podium'] },
  { id: 'town-relay', name: '全镇任务接力', venue: 'main-town', labels: ['广场公告', '书院整理', '集市配送', '茶庄协作', '工坊组装', '街巷服务', '广场颁奖'], checkpoints: ['plaza', 'academy', 'morning-market', 'tea-house', 'workshop', 'town-office', 'plaza'], props: ['notice', 'books', 'delivery-crates', 'service-tokens', 'parts', 'service-stall', 'podium'] },
  { id: 'island-resources', name: '荒岛资源协作', venue: 'trial-island', labels: ['码头集合与登船', '工具搜集', '食物分配', '营地休整', '团队建造', '资源护送', '颁奖与返程'], checkpoints: ['old-dock', 'island-resource-zone', 'island-courtyard', 'island-courtyard', 'island-team-field', 'island-final', 'island-awards'], props: ['ferry', 'toolbox', 'food-crates', 'water-table', 'building-parts', 'supply-cart', 'podium'] },
  { id: 'market-business', name: '小镇经营赛', venue: 'main-town', labels: ['镇公所登记', '集市采购', '工坊生产', '茶庄休整', '食肆服务', '集市结算', '广场颁奖'], checkpoints: ['town-office', 'morning-market', 'workshop', 'tea-house', 'restaurant', 'morning-market', 'plaza'], props: ['contracts', 'market-stalls', 'materials', 'tea-table', 'serving-trays', 'ledger', 'podium'] },
  { id: 'community-service', name: '邻里公共服务赛', venue: 'main-town', labels: ['镇公所任务公告', '书院整理图书', '药庐分类物资', '茶庄休整', '码头协助装卸', '街巷便民服务', '广场总结'], checkpoints: ['town-office', 'academy', 'herb-clinic', 'tea-house', 'old-dock', 'morning-market', 'plaza'], props: ['notice-board', 'books', 'supply-crates', 'tea-table', 'cargo-crates', 'service-stall', 'summary-board'] },
  { id: 'cooking-craft', name: '厨艺与手作赛', venue: 'main-town', labels: ['集市集合', '食材采购', '工坊制作', '茶庄试味', '食肆决赛', '公共评审', '广场颁奖'], checkpoints: ['morning-market', 'morning-market', 'workshop', 'tea-house', 'restaurant', 'restaurant', 'plaza'], props: ['baskets', 'ingredients', 'workbenches', 'tasting-table', 'cooking-stations', 'score-cards', 'podium'] },
  { id: 'relay-build', name: '团队接力与建造赛', venue: 'trial-island', labels: ['码头集合与登船', '赛道接力', '踏板运送', '庭院休整', '团队组装', '彩旗冲刺', '颁奖与返程'], checkpoints: ['old-dock', 'island-track', 'island-bridge', 'island-courtyard', 'island-team-field', 'island-final', 'island-awards'], props: ['ferry', 'batons', 'light-tiles', 'water-table', 'building-parts', 'finish-flags', 'podium'] },
];

export const dailyEventTemplates: DailyEventTemplate[] = configurations.map((config) => ({
  id: config.id,
  name: config.name,
  venue: config.venue,
  teamCount: 2,
  eliminationResult: 'spectator',
  stages: stageIds.map((id, index) => ({
    id,
    label: config.labels[index],
    endsAtMinute: ends[index],
    targetActive: active[index],
    checkpoints: [config.checkpoints[index]],
    props: [config.props[index]],
    choices: choices[index],
  })),
}));
```

- [ ] **Step 4: Run template tests and verify GREEN**

Run: `npm test -- --runInBand convex/events/dailyTemplates.test.ts`

Expected: PASS with exactly seven templates.

- [ ] **Step 5: Commit template definitions**

```bash
git add convex/events/dailyTemplates.ts convex/events/dailyTemplates.test.ts
git commit -m "feat: define safe daily event templates"
```

### Task 3: Bound daily themes to local Gemma

**Files:**
- Create: `convex/events/dailyTheme.ts`
- Create: `convex/events/dailyTheme.test.ts`
- Modify: `convex/events/model.ts`
- Modify: `convex/events/model.test.ts`

- [ ] **Step 1: Write failing theme-boundary tests**

```ts
import { requestDailyTheme } from './dailyTheme';
import { dailyEventTemplates } from './dailyTemplates';
import type { LLMConfig } from '../util/llm';
import { requestEventDecision } from './model';

const templateFixture = dailyEventTemplates[0];
const ollamaConfig: LLMConfig = {
  provider: 'ollama', url: 'http://127.0.0.1:11434', chatModel: 'gemma4:12b',
  embeddingModel: 'mxbai-embed-large', embeddingDimension: 1024,
  stopWords: [], apiKey: undefined,
};

test('accepts only a short name and announcement from Ollama', async () => {
  const result = await requestDailyTheme(templateFixture, '2026-07-17', {
    getConfig: () => ollamaConfig,
    complete: async () => ({ content: '{"name":"荷香协作赛","announcement":"安全完成每一关，淘汰者进入观众席。"}' }),
  });
  expect(result).toEqual({ name: '荷香协作赛', announcement: '安全完成每一关，淘汰者进入观众席。', source: 'model' });
});

test('falls back for paid providers, invalid JSON or unsafe wording', async () => {
  await expect(requestDailyTheme(templateFixture, '2026-07-17', {
    getConfig: () => ({ ...ollamaConfig, provider: 'openai' }),
    complete: async () => ({ content: '{}' }),
  })).resolves.toMatchObject({ source: 'fallback', name: templateFixture.name });
});

test('reuses the resident decision boundary for a daily stage and rejects unsafe quotes', async () => {
  const decision = await requestEventDecision({
    residentId: 'p:lin', displayName: '林澜', identity: '谨慎而愿意合作。',
    phase: 'round-one', choices: templateFixture.stages[1].choices,
  }, {
    getConfig: () => ollamaConfig,
    complete: async () => ({ content: '{"choiceId":"steady","publicQuote":"有人受伤才算赢。"}' }),
  });
  expect(decision.source).toBe('fallback');
  expect(decision.publicQuote).not.toMatch(/死亡|受伤|处决|流血/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/events/dailyTheme.test.ts`

Expected: FAIL because `dailyTheme.ts` is absent.

- [ ] **Step 3: Implement a JSON-only, local-only theme request**

```ts
import { chatCompletion, getLLMConfig, type LLMConfig } from '../util/llm';
import type { DailyEventTemplate } from './dailyTemplates';

type ThemeDependencies = {
  getConfig: () => LLMConfig;
  complete: (body: Parameters<typeof chatCompletion>[0]) => Promise<{ content: string }>;
};

const unsafe = /死亡|受伤|处决|流血/;

export function fallbackDailyTheme(template: DailyEventTemplate) {
  return {
    name: template.name,
    announcement: `${template.name}将在安全规则下举行，退出比赛的居民会进入观众席。`,
    source: 'fallback' as const,
  };
}

export function buildDailyThemePrompt(template: DailyEventTemplate, dayKey: string) {
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
  dependencies: ThemeDependencies = {
    getConfig: getLLMConfig,
    complete: (body) => chatCompletion({ ...body, stream: false }),
  },
) {
  const fallback = fallbackDailyTheme(template);
  const config = dependencies.getConfig();
  if (config.provider !== 'ollama') return fallback;
  try {
    const response = await dependencies.complete({
      model: config.chatModel,
      messages: [{ role: 'user', content: buildDailyThemePrompt(template, dayKey) }],
      temperature: 0.5,
      max_tokens: 180,
      response_format: { type: 'json_object' },
      stream: false,
    });
    const parsed = JSON.parse(response.content) as { name?: unknown; announcement?: unknown };
    if (typeof parsed.name !== 'string' || typeof parsed.announcement !== 'string') return fallback;
    const name = parsed.name.trim();
    const announcement = parsed.announcement.trim();
    if (Array.from(name).length < 2 || Array.from(name).length > 20) return fallback;
    if (Array.from(announcement).length < 10 || Array.from(announcement).length > 80) return fallback;
    if (unsafe.test(name + announcement)) return fallback;
    return { name, announcement, source: 'model' as const };
  } catch {
    return fallback;
  }
}
```

In `events/model.ts`, widen `EventDecisionInput.phase` from legacy `EventPhase` to
`EventPhase | DailyStageId`, reuse the stage's finite `choices`, and apply the same
`unsafe` expression to model quotes before accepting them. Keep the existing
`provider === 'ollama'` guard and deterministic `fallbackDecision`, so no paid
provider is called and a stage can proceed without Gemma.

```ts
import type { DailyStageId } from './dailyTemplates';

export type EventDecisionInput = {
  residentId: string;
  displayName: string;
  identity: string;
  phase: EventPhase | DailyStageId;
  choices: EventChoice[];
};

const unsafePublicQuote = /死亡|受伤|处决|流血/;
const isSafePublicQuote = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && !unsafePublicQuote.test(value);

// Use this in requestEventDecision's parsed-output validation:
if (!isSafePublicQuote(parsed.publicQuote)) return fallbackDecision(input);
```

- [ ] **Step 4: Run tests and type-check**

Run: `npm test -- --runInBand convex/events/dailyTheme.test.ts convex/events/model.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit the theme boundary**

```bash
git add convex/events/dailyTheme.ts convex/events/dailyTheme.test.ts convex/events/model.ts convex/events/model.test.ts
git commit -m "feat: theme and decide daily events with local Gemma"
```

### Task 4: Implement the idempotent daily event state machine

**Files:**
- Create: `convex/events/dailyStateMachine.ts`
- Create: `convex/events/dailyStateMachine.test.ts`

- [ ] **Step 1: Write failing progression and safety tests**

```ts
import { createDailyEventState, advanceDailyEventToStage } from './dailyStateMachine';
import { dailyEventTemplates } from './dailyTemplates';

const start = Date.parse('2026-07-17T04:00:00Z');
const templateFixture = dailyEventTemplates[0];
const residents9 = ['林澜', '沈砚', '唐果', '墨七', '苏萤', '白露', '顾潮', '阿满', '玄微先生']
  .map((displayName, index) => ({ residentId: `p:${index}`, displayName }));

test('advances nine residents through seven stages and archives one winner', () => {
  let state = createDailyEventState('world', residents9, templateFixture, '2026-07-17', 17, start);
  expect(new Set(state.participants.map((entry) => entry.teamId))).toEqual(new Set(['jade', 'amber']));
  for (let stageIndex = 1; stageIndex <= 6; stageIndex += 1) {
    state = advanceDailyEventToStage(state, stageIndex, start + stageIndex * 1_000);
  }
  expect(state.status).toBe('completed');
  expect(state.participants.filter((entry) => entry.role === 'winner')).toHaveLength(1);
  expect(state.participants.filter((entry) => entry.role === 'spectator')).toHaveLength(8);
  expect(state.log.some((entry) => /死亡|受伤/.test(entry.text))).toBe(false);
});

test('ignores duplicate stage advancement', () => {
  const state = createDailyEventState('world', residents9, templateFixture, '2026-07-17', 17, start);
  const once = advanceDailyEventToStage(state, 1, start + 1_000);
  expect(advanceDailyEventToStage(once, 1, start + 2_000)).toBe(once);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/events/dailyStateMachine.test.ts`

Expected: FAIL because the daily state machine is absent.

- [ ] **Step 3: Implement template-driven state and spectator elimination**

```ts
import type { DailyEventTemplate } from './dailyTemplates';

export type DailyEventParticipant = {
  residentId: string;
  displayName: string;
  teamId: 'jade' | 'amber';
  score: number;
  active: boolean;
  role: 'competitor' | 'spectator' | 'winner';
};
export type DailyEventLogEntry = { sequence: number; stageIndex: number; text: string; createdAt: number };
export type DailyEventState = {
  worldId: string;
  dayKey: string;
  seed: number;
  template: DailyEventTemplate;
  stageIndex: number;
  status: 'running' | 'completed';
  participants: DailyEventParticipant[];
  log: DailyEventLogEntry[];
};

const stableScore = (key: string) => {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return Math.abs(hash | 0) % 100;
};

export function createDailyEventState(
  worldId: string,
  residents: Array<{ residentId: string; displayName: string }>,
  template: DailyEventTemplate,
  dayKey: string,
  seed: number,
  createdAt: number,
): DailyEventState {
  return {
    worldId, dayKey, seed, template, stageIndex: 0, status: 'running',
    participants: residents.map((resident, index) => ({
      ...resident, teamId: index % 2 === 0 ? 'jade' : 'amber',
      score: 0, active: true, role: 'competitor',
    })),
    log: [{ sequence: 0, stageIndex: 0, text: `${template.name}已公告，所有居民安全参赛。`, createdAt }],
  };
}

export function advanceDailyEventToStage(
  state: DailyEventState,
  targetStageIndex: number,
  createdAt: number,
  decisions: Record<string, string> = {},
): DailyEventState {
  if (targetStageIndex <= state.stageIndex || state.status === 'completed') return state;
  let next = structuredClone(state);
  const lastStage = Math.min(targetStageIndex, next.template.stages.length - 1);
  for (let index = next.stageIndex + 1; index <= lastStage; index += 1) {
    const stage = next.template.stages[index];
    const ranked = next.participants
      .filter((participant) => participant.active)
      .map((participant) => ({
        ...participant,
        score: participant.score + stableScore(
          `${next.seed}:${next.template.id}:${stage.id}:${participant.residentId}:${decisions[participant.residentId] ?? 'fallback'}`,
        ),
      }))
      .sort((a, b) => b.score - a.score || a.residentId.localeCompare(b.residentId));
    const activeIds = new Set(ranked.slice(0, stage.targetActive).map((participant) => participant.residentId));
    const scores = new Map(ranked.map((participant) => [participant.residentId, participant.score]));
    next.participants = next.participants.map((participant) => ({
      ...participant,
      score: scores.get(participant.residentId) ?? participant.score,
      active: participant.active && activeIds.has(participant.residentId),
      role: participant.active && activeIds.has(participant.residentId) ? 'competitor' : 'spectator',
    }));
    next.stageIndex = index;
    next.log.push({ sequence: next.log.length, stageIndex: index, text: `${stage.label}完成，退出者转入观众席。`, createdAt });
  }
  if (lastStage === next.template.stages.length - 1) {
    const winner = next.participants.filter((entry) => entry.active)
      .sort((a, b) => b.score - a.score || a.residentId.localeCompare(b.residentId))[0];
    next.participants = next.participants.map((entry) => entry.residentId === winner.residentId
      ? { ...entry, role: 'winner' as const }
      : { ...entry, active: false, role: 'spectator' as const });
    next.status = 'completed';
    next.log.push({ sequence: next.log.length, stageIndex: lastStage, text: `${winner.displayName}获得冠军，居民开始安全返程。`, createdAt });
  }
  return next;
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --runInBand convex/events/dailyStateMachine.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the state machine**

```bash
git add convex/events/dailyStateMachine.ts convex/events/dailyStateMachine.test.ts
git commit -m "feat: run safe daily event state machine"
```

### Task 5: Persist exactly one daily event and preserve the legacy archive

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/events.ts`
- Modify: `convex/crons.ts`
- Modify: `convex/events/dailySchedule.test.ts`

- [ ] **Step 1: Write failing persistence source and behavior tests**

```ts
import { readFileSync } from 'node:fs';
import { dailyEventAction } from './dailySchedule';

test('keeps daily event persistence backward compatible', () => {
  const schema = readFileSync(new URL('../schema.ts', import.meta.url), 'utf8');
  for (const field of ['dailyKey', 'templateId', 'eventName', 'venueMode', 'startedAt', 'endedAt', 'archiveReason']) {
    expect(schema).toContain(`${field}: v.optional(`);
  }
  expect(schema).toContain(".index('worldDay', ['worldId', 'dailyKey'])");
  expect(schema).toContain('teamId: v.optional(v.string())');
  expect(schema).toContain('choiceId: v.optional(v.string())');
});

test('selects create, advance, paused archive and missed actions at exact boundaries', () => {
  const noon = Date.parse('2026-07-17T04:00:00Z');
  const end = Date.parse('2026-07-17T06:00:00Z');
  expect(dailyEventAction(noon - 1, 'running', null)).toEqual({ kind: 'none' });
  expect(dailyEventAction(noon, 'running', null)).toEqual({ kind: 'create', stageIndex: 0 });
  expect(dailyEventAction(noon + 75 * 60_000, 'running', { status: 'running', stageIndex: 2 })).toEqual({ kind: 'advance', stageIndex: 4 });
  expect(dailyEventAction(end, 'stoppedByDeveloper', { status: 'running', stageIndex: 4 })).toEqual({ kind: 'archive-paused' });
  expect(dailyEventAction(end, 'running', { status: 'running', stageIndex: 4 })).toEqual({ kind: 'archive', stageIndex: 6 });
  expect(dailyEventAction(end, 'running', null)).toEqual({ kind: 'record-missed' });
});

test('settles participation finalist champion and host rewards exactly once', async () => {
  await settleDailyEventRewards(ctx, eventRewardFixture);
  await settleDailyEventRewards(ctx, eventRewardFixture);
  expect(await rewardAmount(ctx, 'p:participant')).toBe(10);
  expect(await rewardAmount(ctx, 'p:finalist')).toBe(30);
  expect(await rewardAmount(ctx, 'p:champion')).toBe(80);
  expect(await ledgerRowsForEvent(ctx, eventRewardFixture.eventId)).toHaveLength(4);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/events/dailySchedule.test.ts`

Expected: FAIL because daily persistence fields and action selection are absent.

- [ ] **Step 3: Extend the schema compatibly**

```ts
townEvents: defineTable({
  worldId: v.id('worlds'),
  status: v.union(v.literal('scheduled'), v.literal('announced'), v.literal('running'), v.literal('completed')),
  phase: v.string(), seed: v.number(), phaseEndsAt: v.number(), winnerId: v.optional(v.string()), updatedAt: v.number(),
  dailyKey: v.optional(v.string()),
  templateId: v.optional(v.string()),
  eventName: v.optional(v.string()),
  venueMode: v.optional(v.union(v.literal('main-town'), v.literal('trial-island'))),
  startedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
  archiveReason: v.optional(v.string()),
})
  .index('worldId', ['worldId'])
  .index('worldDay', ['worldId', 'dailyKey'])
  .index('status', ['status']),

eventParticipants: defineTable({
  eventId: v.id('townEvents'),
  residentId: v.string(),
  displayName: v.string(),
  identity: v.string(),
  score: v.number(),
  shells: v.number(),
  active: v.boolean(),
  role: v.string(),
  rank: v.optional(v.number()),
  quote: v.optional(v.string()),
  decisionPhase: v.optional(v.string()),
  teamId: v.optional(v.string()),
  choiceId: v.optional(v.string()),
}).index('eventId', ['eventId']),
```

- [ ] **Step 4: Replace one-off creation with daily scheduling**

In `advanceActiveEvents`, read `worldStatus.status` before acting. Query the `worldDay` index with the current Shanghai key. Never mutate the completed legacy event into a daily event. During the live window create exactly one daily event from the selected template and Gemma/fallback theme, or catch up directly to the wall-clock stage. When paused, do not create or advance. At or after 14:00, complete an existing event or insert one factual missed record if no event exists for that day.

Because Convex mutations cannot make the Ollama HTTP request, the creation mutation first saves the deterministic fallback theme and schedules `generateDailyTheme`. That internal action rechecks that the world is running, calls `requestDailyTheme`, then invokes an idempotent `saveDailyTheme` mutation. The save mutation patches only the same day's stage-0 event and inserts at most one announcement log, so a slow model response cannot rewrite a later stage or an archived event.

Generalize the existing `decisionCandidate → generateNextDecision → saveDecision` pipeline: first return `null` unless `worldStatus.status === 'running'`; resolve choices from `dailyEventTemplates[event.templateId].stages[event.stageIndex]`, request only one resident decision at a time from local Gemma, persist `teamId`, `choiceId`, `quote` and `decisionPhase`, and immediately schedule the next undecided resident. The unique event-log key remains `quote:${phase}:${residentId}`. At stage advancement, pass the saved choices to `advanceDailyEventToStage`; a missing or failed choice uses its deterministic fallback. Write `lifeEvents` for participation, explicit exchanges, spectator transitions and return to ordinary life. Completion clears activity-specific player descriptions before normal life scheduling resumes.

At awards/archive call `internal.townEconomy.settleDailyEventRewards` with stored participant status and host institutions. It writes `event:<eventId>:<residentId>:participation`, `:finalist`, `:champion` and `event:<eventId>:host:<institutionId>` idempotency keys. Participation pays 10 金贝, finalist status adds 20, champion status adds 50, and each recorded host service transfers its configured amount to the institution. The old million-gold event never enters this settlement path.

Rename the cron label to `advance daily town activity` but keep `{ seconds: 30 }`.

- [ ] **Step 5: Run codegen, tests and commit**

Run: `npx convex codegen && npm test -- --runInBand convex/events/dailySchedule.test.ts convex/events/dailyStateMachine.test.ts convex/events/model.test.ts && npx tsc --noEmit`

Expected: PASS.

```bash
git add convex/schema.ts convex/events.ts convex/crons.ts convex/events/dailySchedule.test.ts convex/_generated
git commit -m "feat: persist one daily town activity"
```

### Task 6: Expand the world and implement the ferry transfer

**Files:**
- Modify: `data/worlds/lighthouse-town/map.ts`
- Modify: `src/components/worldArt.test.ts`
- Modify: `convex/aiTown/agentInputs.ts`
- Modify: `convex/events.ts`

- [ ] **Step 1: Write failing expanded-map and transfer tests**

```ts
test('adds a separate trial island region without moving town landmarks', () => {
  expect(mapwidth).toBe(84);
  expect(eventCheckpoints.dock).toEqual({ x: 23, y: 6 });
  expect(trialIslandCheckpoints.arrival.x).toBeGreaterThan(47);
  for (const checkpoint of Object.values(trialIslandCheckpoints)) {
    expect(checkpoint.x).toBeLessThan(mapwidth - 1);
    expect(checkpoint.y).toBeGreaterThan(0);
    expect(objmap[0][checkpoint.x][checkpoint.y]).toBe(-1);
  }
});
```

```ts
test('implements a bounded controlled ferry transfer', () => {
  const inputs = readFileSync(new URL('../../convex/aiTown/agentInputs.ts', import.meta.url), 'utf8');
  expect(inputs).toContain('eventTransfer: inputHandler({');
  expect(inputs).toContain('delete player.pathfinding');
  expect(inputs).toContain('player.position = { ...args.destination }');
  expect(inputs).toContain('args.description.slice(0, 80)');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand src/components/worldArt.test.ts`

Expected: FAIL because the world is still 40 tiles wide and has no island checkpoints.

- [ ] **Step 3: Expand the map to 84×30**

Keep all existing town coordinates 0–39 unchanged. Introduce `TOWN_WIDTH = 40` and change every existing town-generation loop to stop at `TOWN_WIDTH`, not the new global `mapwidth`, so the east-west town paths do not accidentally cross the separating water. Retain the old collision boundary at column 39, fill columns 40–47 with blocked inland water, then build a bounded island in columns 48–82 with walkable paths and obstacle boundaries. Export exact checkpoints:

```ts
export const trialIslandCheckpoints = {
  arrival: { x: 50, y: 15 },
  track: { x: 58, y: 5 },
  bridge: { x: 70, y: 7 },
  courtyard: { x: 57, y: 15 },
  teamField: { x: 69, y: 15 },
  maze: { x: 57, y: 24 },
  resourceZone: { x: 69, y: 24 },
  spectatorStand: { x: 79, y: 20 },
  final: { x: 78, y: 8 },
  awards: { x: 79, y: 15 },
} as const;

const dailyTownCheckpoints: Record<string, { x: number; y: number }> = {
  'old-dock': eventCheckpoints.dock,
  plaza: eventCheckpoints.plaza,
  academy: townLandmarkById('academy').destination,
  'herb-clinic': townLandmarkById('herb-clinic').destination,
  'morning-market': townLandmarkById('morning-market').destination,
  'tea-house': townLandmarkById('tea-house').destination,
  workshop: townLandmarkById('workshop').destination,
  restaurant: townLandmarkById('restaurant').destination,
  'town-office': townLandmarkById('town-office').destination,
  'divination-hall': townLandmarkById('divination-hall').destination,
};
const dailyIslandCheckpoints: Record<string, { x: number; y: number }> = {
  'island-arrival': trialIslandCheckpoints.arrival,
  'island-track': trialIslandCheckpoints.track,
  'island-bridge': trialIslandCheckpoints.bridge,
  'island-courtyard': trialIslandCheckpoints.courtyard,
  'island-team-field': trialIslandCheckpoints.teamField,
  'island-maze': trialIslandCheckpoints.maze,
  'island-resource-zone': trialIslandCheckpoints.resourceZone,
  'island-spectator-stand': trialIslandCheckpoints.spectatorStand,
  'island-final': trialIslandCheckpoints.final,
  'island-awards': trialIslandCheckpoints.awards,
};

export function dailyEventCheckpointById(id: string) {
  const checkpoint = dailyTownCheckpoints[id] ?? dailyIslandCheckpoints[id];
  if (!checkpoint) throw new Error(`Unknown daily event checkpoint: ${id}`);
  return checkpoint;
}
```

- [ ] **Step 4: Add the controlled transfer input**

```ts
eventTransfer: inputHandler({
  args: { playerId, destination: point, description: v.string(), until: v.number() },
  handler: (game, _now, args) => {
    const player = game.world.players.get(parseGameId('players', args.playerId));
    if (!player) return null;
    delete player.pathfinding;
    player.position = { ...args.destination };
    player.activity = { description: args.description.slice(0, 80), emoji: '⛴️', until: args.until };
    return null;
  },
}),
```

Queue normal `eventMove` to the old dock during assembly, `eventTransfer` to island arrival at the first island stage, and the reverse transfer during awards/return. Main-town templates never transfer.

For every island stage, queue active competitors to `dailyEventCheckpointById(stage.checkpoints[0])` and inactive participants to `trialIslandCheckpoints.spectatorStand`. Use offsets on adjacent walkable tiles to avoid stacking all residents on one pixel. During stage 0 keep everyone at the old dock; at stage 1 transfer to `arrival` and then queue ordinary pathfinding. During archive, transfer everyone back to the dock, clear their event activity, and let the normal life scheduler choose the next destination. Catch transfer insertion failures, queue the affected resident back to the old dock and insert one deduplicated `eventLog` failure record.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- --runInBand src/components/worldArt.test.ts convex/events/dailyStateMachine.test.ts && npx tsc --noEmit`

Expected: PASS.

```bash
git add data/worlds/lighthouse-town/map.ts src/components/worldArt.test.ts convex/aiTown/agentInputs.ts convex/events.ts
git commit -m "feat: add trial island ferry movement"
```

### Task 7: Create the expanded map art and dynamic activity overlay

**Files:**
- Create: `public/assets/worlds/lighthouse-town/trial-island-v1.webp`
- Modify: `public/assets/worlds/lighthouse-town/asset-sources.md`
- Modify: `src/components/worldArt.ts`
- Modify: `src/components/PixiStaticMap.tsx`
- Create: `src/components/EventMapOverlay.tsx`
- Create: `src/components/EventMapOverlay.test.ts`
- Modify: `src/components/PixiGame.tsx`

- [ ] **Step 1: Write failing asset and overlay contracts**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { worldArtForMap } from './worldArt';

test('uses the expanded map art and event overlay', () => {
  expect(worldArtForMap('/ai-town/assets/worlds/lighthouse-town/tileset.svg')?.segments)
    .toEqual([
      { url: '/ai-town/assets/worlds/lighthouse-town/playable-map-v1.webp', xTiles: 0, widthTiles: 40 },
      { url: '/ai-town/assets/worlds/lighthouse-town/trial-island-v1.webp', xTiles: 40, widthTiles: 44 },
    ]);
  expect(existsSync(new URL('../../public/assets/worlds/lighthouse-town/trial-island-v1.webp', import.meta.url))).toBe(true);
  const pixiGame = readFileSync(new URL('./PixiGame.tsx', import.meta.url), 'utf8');
  const staticMap = readFileSync(new URL('./PixiStaticMap.tsx', import.meta.url), 'utf8');
  expect(pixiGame).toContain('<EventMapOverlay');
  expect(pixiGame).toContain('event={eventSnapshot.event}');
  expect(staticMap).toContain('for (const segment of worldArt.segments)');
  expect(staticMap).toContain('art.x = segment.xTiles * map.tileDim');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand src/components/worldArt.test.ts src/components/EventMapOverlay.test.ts`

Expected: FAIL because the v2 asset and overlay do not exist.

- [ ] **Step 3: Generate the expanded artwork with the imagegen skill**

Use the existing `playable-map-v1.webp` only as a style reference and generate the right-hand segment, not a replacement town image. The first 8 tile columns are open water; the remaining 36 contain a matching Jiangnan pixel-art competition island with a distinct track, luminous stepping bridge, team field, courtyard, maze, resource yard, spectator stand and awards plaza. Export `trial-island-v1.webp` at exactly **1408×960** pixels (44×30 tiles at 32 pixels per tile) and record the prompt/provenance in `asset-sources.md`.

Change `WorldArt` to expose `segments`. In `PixiStaticMap`, create one sprite per segment: render the existing `playable-map-v1.webp` at `x=0`, width `40 * tileDim`, and the new island segment at `x=40 * tileDim`, width `44 * tileDim`. Both use height `30 * tileDim`. Never stretch or regenerate the existing town image.

```ts
export type WorldArt = {
  segments: Array<{ url: string; xTiles: number; widthTiles: number }>;
  backgroundAlpha: number;
  objectAlpha: number;
};

export function worldArtForMap(tileSetUrl: string): WorldArt | undefined {
  if (!tileSetUrl.includes('/worlds/lighthouse-town/')) return undefined;
  return {
    segments: [
      { url: '/ai-town/assets/worlds/lighthouse-town/playable-map-v1.webp', xTiles: 0, widthTiles: 40 },
      { url: '/ai-town/assets/worlds/lighthouse-town/trial-island-v1.webp', xTiles: 40, widthTiles: 44 },
    ],
    backgroundAlpha: 1,
    objectAlpha: 0.82,
  };
}
```

- [ ] **Step 4: Implement stage-driven Pixi overlays**

Create a focused overlay component receiving `{ tileDim, event, paused }`. Use Pixi graphics/text to draw only the active template props: translucent stage zone, route arrow, team-color markers, score labels, and icons for rope, light tiles, chest, stall, material box or podium. Key the overlay by `event.id:event.phase` so stale props are destroyed on stage change.

Render the ferry as an animated overlay on the fixed route
`[{x:23,y:6},{x:32,y:3},{x:41,y:3},{x:47,y:9},{x:50,y:15}]` during the final three minutes of assembly, and in reverse during the final three minutes of awards. Interpolate by wall-clock time from stored `startedAt`/`phaseEndsAt`. Use Pixi's local ticker to update only the ferry sprite, return immediately when `paused` is true, and never create a render-loop network request. The controlled player transfer occurs only at route completion, so residents appear aboard until arrival.

- [ ] **Step 5: Verify assets and commit**

Run: `sips -g pixelWidth -g pixelHeight public/assets/worlds/lighthouse-town/trial-island-v1.webp && npm test -- --runInBand src/components/worldArt.test.ts src/components/EventMapOverlay.test.ts && npm run validate:world && npm run build`

Expected: `pixelWidth: 1408`, `pixelHeight: 960`; tests, asset validation and build PASS.

```bash
git add public/assets/worlds/lighthouse-town/trial-island-v1.webp public/assets/worlds/lighthouse-town/asset-sources.md src/components/worldArt.ts src/components/PixiStaticMap.tsx src/components/EventMapOverlay.tsx src/components/EventMapOverlay.test.ts src/components/PixiGame.tsx
git commit -m "feat: render daily activities on trial island"
```

### Task 8: Add main-town, island, panorama and follow-event camera controls

**Files:**
- Create: `src/components/MapRegionControls.tsx`
- Create: `src/components/MapRegionControls.test.ts`
- Modify: `src/components/Game.tsx`
- Modify: `src/components/PixiGame.tsx`
- Modify: `src/components/PixiViewport.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing camera-control tests**

```ts
import { readFileSync } from 'node:fs';
import { regionCameraTarget } from './MapRegionControls';

test('renders four map modes and resolves their exact centers', () => {
  const source = readFileSync(new URL('./MapRegionControls.tsx', import.meta.url), 'utf8');
  for (const label of ['主镇', '试炼岛', '全景', '跟随比赛']) expect(source).toContain(label);
  const eventPoint = { x: 70, y: 7 };
  expect(regionCameraTarget('main-town', eventPoint)).toEqual({ x: 20, y: 15 });
  expect(regionCameraTarget('trial-island', eventPoint)).toEqual({ x: 66, y: 15 });
  expect(regionCameraTarget('panorama', eventPoint)).toEqual({ x: 42, y: 15 });
  expect(regionCameraTarget('follow-event', eventPoint)).toEqual(eventPoint);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand src/components/MapRegionControls.test.ts`

Expected: FAIL because controls and target helper are absent.

- [ ] **Step 3: Implement explicit camera state**

Store `mapRegion` in `Game` and pass it plus the active event checkpoint into `PixiGame`. Add an effect that calls `viewport.moveCenter(target.x * tileDim, target.y * tileDim)` and uses a region-appropriate zoom. Do not automatically change the user's selected mode when an event starts; show a non-blocking “活动正在试炼岛举行” badge that switches to follow mode only when clicked.

```ts
export type MapRegion = 'main-town' | 'trial-island' | 'panorama' | 'follow-event';

export function regionCameraTarget(region: MapRegion, eventPoint?: { x: number; y: number }) {
  if (region === 'main-town') return { x: 20, y: 15 };
  if (region === 'trial-island') return { x: 66, y: 15 };
  if (region === 'follow-event' && eventPoint) return eventPoint;
  return { x: 42, y: 15 };
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- --runInBand src/components/MapRegionControls.test.ts src/components/PixiViewport.test.ts && npx tsc --noEmit`

Expected: PASS.

```bash
git add src/components/MapRegionControls.tsx src/components/MapRegionControls.test.ts src/components/Game.tsx src/components/PixiGame.tsx src/components/PixiViewport.tsx src/index.css
git commit -m "feat: navigate town and trial island cameras"
```

### Task 9: Separate live daily activity from historical records

**Files:**
- Modify: `convex/events.ts`
- Modify: `src/components/eventBroadcastView.ts`
- Modify: `src/components/EventBroadcast.tsx`
- Modify: `src/components/EventBroadcast.test.ts`
- Modify: `src/i18n/index.ts`

- [ ] **Step 1: Write failing active/history snapshot tests**

```ts
test('separates a live daily activity from completed daily and legacy history', () => {
  const noon = Date.parse('2026-07-17T04:30:00Z');
  const afterTwo = Date.parse('2026-07-17T06:01:00Z');
  const dailyRunning = { id: 'daily:17', name: '荷香协作赛', status: 'running', phase: 'round-one', phaseEndsAt: noon + 300_000, prize: '参赛10／决赛加20／冠军加50金贝', venueMode: 'trial-island' as const, dailyKey: '2026-07-17' };
  const dailyCompleted = { id: 'daily:16', name: '小镇经营赛', status: 'completed', dailyKey: '2026-07-16', winnerName: '唐果', prize: '冠军共80金贝', logs: [] };
  const legacyCompleted = { id: 'legacy', name: '百万金贝寻宝赛', status: 'completed', dailyKey: undefined, winnerName: '白露', prize: '百万金贝', logs: [] };
  const base = { ...running, eventHistory: [dailyCompleted, legacyCompleted] };
  const liveView = buildBroadcastView({ ...base, event: dailyRunning }, 'zh-CN', noon);
  expect(liveView.title).toBe('今日活动');
  expect(liveView.venueLabel).toBe('灯塔试炼岛');
  expect(liveView.countdown).toMatch(/\d{2}:\d{2}/);

  const historyView = buildBroadcastView({ ...base, event: null }, 'zh-CN', afterTwo);
  expect(historyView.title).toBe('往届活动记录');
  expect(historyView.countdown).toBeUndefined();

  const source = readFileSync(new URL('./EventBroadcast.tsx', import.meta.url), 'utf8');
  expect(source).toContain('snapshot.event && <ActiveDailyEvent');
  expect(source).toContain('<EventHistory events={snapshot.eventHistory}');
  expect(source).not.toContain('eventHistory[0].status === \'running\'');
  expect(base.eventHistory.filter((event) => event.id === 'legacy')).toHaveLength(1);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts`

Expected: FAIL because the snapshot exposes only one latest event and the view still assumes the legacy challenge.

- [ ] **Step 3: Return current activity plus bounded history**

Change `observerSnapshot` to return `event` as the active daily event or `null`, and `eventHistory` as the latest 30 completed/missed events with their winner, reason and ordered logs. Resolve names from stored `eventName` with the legacy name as fallback.

- [ ] **Step 4: Implement strict UI branches**

Render active stage, venue, countdown, teams, scores and spectators only when `snapshot.event` is active. Render a collapsed `往届活动记录` list for completed daily and legacy events. On completion remove live labels immediately; current resident cards continue to use normal `residentActivity` rather than event participant roles.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts && npx tsc --noEmit`

Expected: PASS.

```bash
git add convex/events.ts src/components/eventBroadcastView.ts src/components/EventBroadcast.tsx src/components/EventBroadcast.test.ts src/i18n/index.ts
git commit -m "feat: broadcast daily activities and archive history"
```

### Task 10: Integrate activity evidence into both reports

**Files:**
- Modify: `src/components/eventBroadcastView.ts`
- Modify: `src/components/socialObservationReport.ts`
- Modify: `src/components/socialObservationReport.test.ts`
- Modify: `src/components/EventBroadcast.test.ts`

- [ ] **Step 1: Write failing report integration tests**

```ts
test('records the full daily activity process and observes only explicit interaction evidence', () => {
  const at = (minute: number) => Date.parse('2026-07-17T04:00:00Z') + minute * 60_000;
  const afterTwo = at(125);
  const texts = ['广场集合', '乘船抵达试炼岛', '林澜选择协调团队', '苏萤与林澜交换材料', '唐果转入观众席', '林澜获得冠军', '居民乘船返回主镇'];
  const logs = texts.map((text, index) => ({
    eventKey: `daily:${index}`, sequence: index, kind: 'daily-event', text, createdAt: at(index * 15),
  }));
  const snapshot: BroadcastSnapshot = {
    event: null,
    participants: [],
    logs,
    conversations: [],
    residentActivity: [],
    dailyMessages: [{ messageId: 'm:observer', conversationId: 'c:event', authorId: 'p:human', authorName: 'Me', text: '你们准备怎么分工？', createdAt: at(45), observerIntervention: true }],
    dailyLifeEvents: [{ residentId: 'p:lin', displayName: '林澜', kind: 'life', text: '活动结束后回到镇公所整理日常记录', createdAt: at(121) }],
    eventHistory: [{ id: 'legacy', name: '百万金贝寻宝赛', status: 'completed', dailyKey: '2026-07-16', winnerName: '白露', prize: '百万金贝', logs: [] }],
  };
  const factual = buildDailyReport(snapshot, 'zh-CN', afterTwo);
  expect(factual).toContain('### 当日活动过程');
  expect(factual.indexOf(texts[0])).toBeLessThan(factual.indexOf(texts[5]));
  expect(factual.indexOf(texts[5])).toBeLessThan(factual.indexOf(texts[6]));

  const facts = buildSocialObservationFacts(snapshot, 'zh-CN', afterTwo);
  const social = buildSocialObservationReport(facts, {
    source: 'fallback', fallbackReason: '模型不可用',
    findings: facts.ruleFindings, limitations: facts.limitations, followUps: facts.followUps,
  });
  expect(social).toContain('## 活动重点观察');
  expect(social).toContain('转入观众席');
  expect(social).toContain('观察者介入阶段');
  expect(social).toContain('比赛选择仅代表当时规则与处境，不直接代表稳定人格。');
  expect(social).not.toContain('昨天的百万金贝赛事属于今天');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts src/components/socialObservationReport.test.ts`

Expected: FAIL because neither report has activity-specific sections.

- [ ] **Step 3: Add factual and cautious activity sections**

In the factual ledger, render event logs verbatim with timestamps and stored event identity. In social facts, derive only explicit team membership, action choices, spectator transitions, institution use, observer messages and post-event life records. Do not translate a competitive choice into stable personality. Include these bounded facts in the Gemma digest and add the exact method note: `比赛选择仅代表当时规则与处境，不直接代表稳定人格。`

- [ ] **Step 4: Run report tests and commit**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts src/components/socialObservationReport.test.ts`

Expected: PASS.

```bash
git add src/components/eventBroadcastView.ts src/components/socialObservationReport.ts src/components/socialObservationReport.test.ts src/components/EventBroadcast.test.ts
git commit -m "feat: observe daily activity evidence in reports"
```

### Task 11: Verify safety, recovery, performance and live behavior

**Files:**
- Modify: `README.md`
- Modify: `src/components/Game.tsx`
- Modify: `src/components/PixiGame.tsx`
- Modify: `src/components/EventMapOverlay.tsx`
- Modify: `src/components/worldArt.test.ts`
- Test: all event, map, report and world suites

- [ ] **Step 1: Write the failing low-power pause contract**

```ts
test('stops local rendering while paused without unloading Ollama', () => {
  const game = readFileSync(new URL('./Game.tsx', import.meta.url), 'utf8');
  const pixi = readFileSync(new URL('./PixiGame.tsx', import.meta.url), 'utf8');
  expect(game).toContain("paused={worldStatus.status === 'stoppedByDeveloper'}");
  expect(pixi).toContain('pixiApp.ticker.stop()');
  expect(pixi).toContain('pixiApp.ticker.start()');
  expect(pixi).not.toMatch(/ollama\s+(stop|rm)|OLLAMA_KEEP_ALIVE\s*=\s*0/);
});
```

Run: `npm test -- --runInBand src/components/worldArt.test.ts`

Expected: FAIL because pause currently stops the world engine but not the local Pixi ticker.

- [ ] **Step 2: Stop rendering and animation work during manual pause**

Pass `paused={worldStatus.status === 'stoppedByDeveloper'}` from `Game` to `PixiGame` and `EventMapOverlay`.

```ts
useEffect(() => {
  if (props.paused) {
    pixiApp.ticker.stop();
    return;
  }
  pixiApp.ticker.start();
}, [pixiApp, props.paused]);
```

The Convex event mutation and decision candidate already return without scheduling new work while paused. Keep Ollama and `gemma4:12b` loaded; pause means no automatic inference, not model removal. On resume, restart the ticker and let the schedule catch up only within the remaining 12:00–14:00 window.

- [ ] **Step 3: Document operation and boundaries**

Document Shanghai schedule, seven templates, Trial Island ferry, safe spectator elimination, pause/catch-up/missed behavior, local-only Gemma fallback, live/history separation, the two report integrations, and that manual pause stops rendering/automatic inference without unloading the resident model.

- [ ] **Step 4: Run complete automated verification**

Run:

```bash
npm test -- --runInBand
npx tsc --noEmit
npm run validate:world
npm run build
./scripts/check-lighthouse-site.sh
git diff --check
```

Expected: all suites pass; TypeScript and production/client-boundary builds pass; assets validate; `frontend=200 backend=tcp-open`; no whitespace errors.

- [ ] **Step 5: Exercise time and failure boundaries**

Use tests or development-only clock injection to verify 11:59:59, 12:00:00, each stage boundary, 13:59:59 and 14:00:00 Shanghai. Repeat the same 30-second tick twice and confirm no duplicate event, points or logs. Test Ollama unavailable, world paused, transfer failure and service restart mid-window.

- [ ] **Step 6: Browser acceptance**

Open `http://localhost:5173/ai-town`. Verify main town and island controls, stage overlay, resident movement to dock, ferry transition, island movement, spectator area, awards, return, immediate live-state cleanup, history archive, and both report exports. Press pause and confirm residents, ferry, overlays and new automatic model requests stop while the page remains visible; resume and confirm rendering restarts. Confirm the browser console has zero application errors.

- [ ] **Step 7: Commit release documentation and pause optimization**

```bash
git add README.md src/components/Game.tsx src/components/PixiGame.tsx src/components/EventMapOverlay.tsx src/components/worldArt.test.ts
git commit -m "perf: idle town rendering during pause"
```
