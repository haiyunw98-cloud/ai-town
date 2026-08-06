# 灯塔镇九人狼人杀 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在灯塔镇实现可由九位 AI 自行进行、也允许观察者占一个座位加入的九人狼人杀，并完整保存秘密行动、公开发言、投票、关系与经济结果。

**Architecture:** 使用独立的纯函数状态机管理规则，Convex 三张专用表持久化会话、座位和动作，串行调度本地 Gemma 12B 生成 AI 行动。服务端角色视图过滤器是秘密信息唯一出口；地图、观察台、奖励和日报通过小型适配层接入现有系统。

**Tech Stack:** TypeScript、Convex、React、PixiJS、Jest、Ollama Gemma 12B、现有灯塔镇经济/关系/日报模块。

---

## 文件结构

- Create `convex/werewolf/types.ts`: 角色、阶段、座位、动作和公开快照类型。
- Create `convex/werewolf/setup.ts`: 可复现身份分配与九人座位初始化。
- Create `convex/werewolf/stateMachine.ts`: 夜晚、白天、平票、猎人和胜负规则。
- Create `convex/werewolf/privacy.ts`: 按查看者身份生成最小秘密视图。
- Create `convex/werewolf/model.ts`: 本地 Gemma 行动提示、验证和规则回退。
- Create `convex/werewolf/movement.ts`: 圆桌座位、观众席与地图移动命令。
- Create `convex/werewolf.ts`: Convex 查询、用户操作、持久化和调度入口。
- Modify `convex/schema.ts`: 新增 `werewolfSessions`、`werewolfSeats`、`werewolfActions`。
- Modify `convex/townEconomy.ts`: 幂等阵营奖励结算。
- Modify `convex/townRelations.ts`: 只根据公开真实行动写入小幅关系变化。
- Modify `data/worlds/lighthouse-town/map.ts`: 导出圆桌和观众席坐标。
- Create `src/components/WerewolfPanel.tsx`: 开局、公开过程、私密操作和赛后复盘。
- Create `src/components/WerewolfMapOverlay.tsx`: 圆桌、昼夜、发言、投票与观众席标记。
- Create `src/components/werewolfView.ts`: 纯前端视图转换。
- Modify `src/components/EventBroadcast.tsx`: 挂载狼人杀卡片。
- Modify `src/components/PixiGame.tsx`: 挂载地图覆盖层。
- Modify `src/components/socialObservationReport.ts`: 纳入公开狼人杀事实与关系证据。
- Modify `src/components/reportExportController.ts`: 事实流水账纳入狼人杀动作。

---

### Task 1: 九人身份与座位初始化

**Files:**
- Create: `convex/werewolf/types.ts`
- Create: `convex/werewolf/setup.ts`
- Test: `convex/werewolf/setup.test.ts`

- [ ] **Step 1: 写身份分配失败测试**

```ts
import { createWerewolfSetup } from './setup';

const ai = Array.from({ length: 9 }, (_, index) => ({
  playerId: `p:${index}`,
  displayName: `居民${index}`,
  kind: 'ai' as const,
}));

test('九个座位严格分配三狼三民和三个神职', () => {
  const setup = createWerewolfSetup(ai, 20260806);
  expect(setup).toHaveLength(9);
  expect(setup.map((seat) => seat.seatNumber)).toEqual([1,2,3,4,5,6,7,8,9]);
  expect(setup.map((seat) => seat.role).sort()).toEqual(
    ['hunter','seer','villager','villager','villager','werewolf','werewolf','werewolf','witch'].sort(),
  );
});

test('相同种子产生相同身份，不同种子改变分配', () => {
  expect(createWerewolfSetup(ai, 7)).toEqual(createWerewolfSetup(ai, 7));
  expect(createWerewolfSetup(ai, 7)).not.toEqual(createWerewolfSetup(ai, 8));
});

test('观察者加入后只选择八位 AI 并占一个座位', () => {
  const setup = createWerewolfSetup([
    ...ai.slice(0, 8),
    { playerId: 'p:human', displayName: '你', kind: 'human' as const },
  ], 11);
  expect(setup.filter((seat) => seat.kind === 'human')).toHaveLength(1);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --runInBand convex/werewolf/setup.test.ts`

Expected: FAIL，提示找不到 `./setup`。

- [ ] **Step 3: 添加最小类型和可复现洗牌**

```ts
// convex/werewolf/types.ts
export type WerewolfRole = 'werewolf' | 'villager' | 'seer' | 'witch' | 'hunter';
export type WerewolfCamp = 'wolves' | 'good';
export type WerewolfPhase =
  | 'night-wolves' | 'night-seer' | 'night-witch' | 'dawn'
  | 'day-speaking' | 'day-voting' | 'runoff-speaking' | 'runoff-voting'
  | 'hunter' | 'completed';

export type WerewolfEntrant = Readonly<{
  playerId: string;
  displayName: string;
  kind: 'ai' | 'human';
}>;

export type WerewolfSeat = WerewolfEntrant & {
  seatNumber: number;
  role: WerewolfRole;
  alive: boolean;
  eliminatedRound?: number;
  eliminatedBy?: 'wolves' | 'witch' | 'vote' | 'hunter';
  antidoteAvailable: boolean;
  poisonAvailable: boolean;
  hunterShotAvailable: boolean;
};
```

```ts
// convex/werewolf/setup.ts
import type { WerewolfEntrant, WerewolfRole, WerewolfSeat } from './types';

const ROLES: readonly WerewolfRole[] = [
  'werewolf', 'werewolf', 'werewolf',
  'villager', 'villager', 'villager',
  'seer', 'witch', 'hunter',
];

function next(seed: number) {
  return Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0;
}

export function createWerewolfSetup(
  entrants: readonly WerewolfEntrant[],
  seed: number,
): WerewolfSeat[] {
  if (entrants.length !== 9 || new Set(entrants.map((entry) => entry.playerId)).size !== 9) {
    throw new Error('Werewolf requires nine unique entrants.');
  }
  if (!Number.isSafeInteger(seed)) throw new Error('Werewolf seed must be an integer.');
  const roles = [...ROLES];
  let state = seed >>> 0;
  for (let index = roles.length - 1; index > 0; index -= 1) {
    state = next(state + index);
    const target = state % (index + 1);
    [roles[index], roles[target]] = [roles[target], roles[index]];
  }
  return entrants.map((entrant, index) => ({
    ...entrant,
    seatNumber: index + 1,
    role: roles[index],
    alive: true,
    antidoteAvailable: roles[index] === 'witch',
    poisonAvailable: roles[index] === 'witch',
    hunterShotAvailable: roles[index] === 'hunter',
  }));
}
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npm test -- --runInBand convex/werewolf/setup.test.ts`

Expected: PASS 3 tests。

- [ ] **Step 5: 提交**

```bash
git add convex/werewolf/types.ts convex/werewolf/setup.ts convex/werewolf/setup.test.ts
git commit -m "feat: add deterministic werewolf setup"
```

---

### Task 2: 夜间规则状态机

**Files:**
- Create: `convex/werewolf/stateMachine.ts`
- Test: `convex/werewolf/stateMachine.test.ts`

- [ ] **Step 1: 写狼人、预言家和女巫规则失败测试**

```ts
import { beginWerewolfGame, applyWerewolfAction } from './stateMachine';
import { createWerewolfSetup } from './setup';

const seats = createWerewolfSetup(Array.from({ length: 9 }, (_, i) => ({
  playerId: `p:${i}`, displayName: `居民${i}`, kind: 'ai' as const,
})), 19);

function advanceWolves(state: ReturnType<typeof beginWerewolfGame>) {
  const wolves = state.seats.filter((seat) => seat.role === 'werewolf');
  const target = state.seats.find((seat) => seat.role !== 'werewolf')!;
  return wolves.reduce((current, wolf) => applyWerewolfAction(current, {
    kind: 'wolf-vote', actorId: wolf.playerId, targetId: target.playerId, at: current.updatedAt + 1,
  }), state);
}

test('三名狼人提交后进入预言家阶段且多数票成为夜袭目标', () => {
  let state = beginWerewolfGame(seats, 19, 1000);
  const wolves = state.seats.filter((seat) => seat.role === 'werewolf');
  const target = state.seats.find((seat) => seat.role !== 'werewolf')!;
  for (const wolf of wolves) {
    state = applyWerewolfAction(state, { kind: 'wolf-vote', actorId: wolf.playerId, targetId: target.playerId, at: state.updatedAt + 1 });
  }
  expect(state.phase).toBe('night-seer');
  expect(state.pendingNightTargetId).toBe(target.playerId);
});

test('预言家只得到阵营结果后进入女巫阶段', () => {
  const nightSeer = advanceWolves(beginWerewolfGame(seats, 19, 1000));
  const seer = nightSeer.seats.find((seat) => seat.role === 'seer')!;
  const wolf = nightSeer.seats.find((seat) => seat.role === 'werewolf')!;
  const result = applyWerewolfAction(nightSeer, {
    kind: 'seer-check', actorId: seer.playerId, targetId: wolf.playerId, at: 2000,
  });
  expect(result.privateResults[seer.playerId].at(-1)).toEqual({ targetId: wolf.playerId, camp: 'wolves' });
  expect(result.phase).toBe('night-witch');
});

test('女巫首夜可自救且同夜不能同时使用两种药', () => {
  const nightSeer = advanceWolves(beginWerewolfGame(seats, 19, 1000));
  const seer = nightSeer.seats.find((seat) => seat.role === 'seer')!;
  const checked = nightSeer.seats.find((seat) => seat.playerId !== seer.playerId)!;
  const nightWitch = applyWerewolfAction(nightSeer, {
    kind: 'seer-check', actorId: seer.playerId, targetId: checked.playerId, at: 2000,
  });
  const witch = nightWitch.seats.find((seat) => seat.role === 'witch')!;
  const poisonTarget = nightWitch.seats.find((seat) => seat.playerId !== witch.playerId)!;
  expect(() => applyWerewolfAction(nightWitch, {
    kind: 'witch-use', actorId: witch.playerId, save: true, poisonTargetId: poisonTarget.playerId, at: 3000,
  })).toThrow(/same night|同一夜/iu);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --runInBand convex/werewolf/stateMachine.test.ts`

Expected: FAIL，提示 `beginWerewolfGame` 未定义。

- [ ] **Step 3: 实现夜间状态和合法动作**

在 `types.ts` 增加：

```ts
export type WerewolfAction =
  | { kind: 'wolf-vote'; actorId: string; targetId: string; at: number }
  | { kind: 'seer-check'; actorId: string; targetId: string; at: number }
  | { kind: 'witch-use'; actorId: string; save: boolean; poisonTargetId?: string; at: number }
  | { kind: 'speech'; actorId: string; text: string; at: number }
  | { kind: 'day-vote'; actorId: string; targetId?: string; at: number }
  | { kind: 'hunter-shot'; actorId: string; targetId?: string; at: number };

export type WerewolfState = {
  seed: number;
  round: number;
  phase: WerewolfPhase;
  seats: WerewolfSeat[];
  actions: WerewolfAction[];
  pendingNightTargetId?: string;
  pendingPoisonTargetId?: string;
  speakingOrder: string[];
  runoffIds: string[];
  privateResults: Record<string, Array<{ targetId: string; camp: WerewolfCamp }>>;
  winner?: WerewolfCamp | 'draw';
  updatedAt: number;
};
```

在 `stateMachine.ts` 实现并导出：

```ts
export function beginWerewolfGame(seats: readonly WerewolfSeat[], seed: number, at: number): WerewolfState;
export function applyWerewolfAction(state: WerewolfState, action: WerewolfAction): WerewolfState;
export function legalTargets(state: WerewolfState, actorId: string): string[];
```

验证角色、存活状态、阶段、重复动作和目标；狼人全部提交后按票数与种子决胜，预言家保存私有查验，女巫消耗药物并进入 `dawn`。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npm test -- --runInBand convex/werewolf/stateMachine.test.ts`

Expected: PASS 夜间规则测试。

- [ ] **Step 5: 提交**

```bash
git add convex/werewolf/types.ts convex/werewolf/stateMachine.ts convex/werewolf/stateMachine.test.ts
git commit -m "feat: implement werewolf night rules"
```

---

### Task 3: 白天发言、投票、猎人和胜负

**Files:**
- Modify: `convex/werewolf/stateMachine.ts`
- Modify: `convex/werewolf/stateMachine.test.ts`

- [ ] **Step 1: 写白天流程失败测试**

```ts
test('天亮后按座位轮流发言并进入秘密投票', () => {
  let state = stateAtDawn();
  state = applySystemStep(state, 4000);
  expect(state.phase).toBe('day-speaking');
  for (const actorId of state.speakingOrder) {
    state = applyWerewolfAction(state, { kind: 'speech', actorId, text: '我先听大家怎么说。', at: state.updatedAt + 1 });
  }
  expect(state.phase).toBe('day-voting');
});

test('首次平票追加发言和重投，再次平票无人离场', () => {
  let state = stateAtDayVoting();
  state = submitTieVotes(state);
  expect(state.phase).toBe('runoff-speaking');
  state = submitRunoffSpeechesAndTieVotes(state);
  expect(state.phase).toBe('night-wolves');
  expect(state.seats.filter((seat) => seat.alive)).toHaveLength(9);
});

test('猎人被投票离场可带走一人，被女巫毒离场不可发动', () => {
  expect(stateAfterHunterVote().phase).toBe('hunter');
  expect(stateAfterHunterPoison().phase).not.toBe('hunter');
});

test('狼全部离场好人胜，狼人达到半数狼人胜', () => {
  expect(evaluateWinner(goodWinSeats())).toBe('good');
  expect(evaluateWinner(wolfWinSeats())).toBe('wolves');
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --runInBand convex/werewolf/stateMachine.test.ts`

Expected: FAIL，提示 `applySystemStep` 或白天阶段尚未实现。

- [ ] **Step 3: 实现白天状态转换**

在 `stateMachine.ts` 增加并导出：

```ts
export function applySystemStep(state: WerewolfState, at: number): WerewolfState;
export function evaluateWinner(seats: readonly WerewolfSeat[]): WerewolfCamp | undefined;
```

`applySystemStep` 在 `dawn` 同时应用夜袭、解药和毒药；随后检查猎人、胜负或进入发言。`applyWerewolfAction` 对发言限制 80 字、加赛限制 40 字，对普通投票禁止投自己并处理一次加赛。猎人动作完成后立即检查胜负，否则进入下一夜。

- [ ] **Step 4: 运行全部状态机测试**

Run: `npm test -- --runInBand convex/werewolf/setup.test.ts convex/werewolf/stateMachine.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add convex/werewolf/stateMachine.ts convex/werewolf/stateMachine.test.ts
git commit -m "feat: complete werewolf round state machine"
```

---

### Task 4: 服务端秘密信息隔离

**Files:**
- Create: `convex/werewolf/privacy.ts`
- Test: `convex/werewolf/privacy.test.ts`

- [ ] **Step 1: 写五种身份和公开观察者的泄密测试**

```ts
import { buildWerewolfViewerState } from './privacy';

test('普通角色不能看到任何其他身份或夜间选择', () => {
  const view = buildWerewolfViewerState(fullState(), 'villager-id');
  expect(JSON.stringify(view)).not.toContain('seer-check');
  expect(view.seats.every((seat) => seat.role === undefined || seat.playerId === 'villager-id')).toBe(true);
});

test('狼人只看到存活狼队友，不看到队友尚未提交的选择', () => {
  const view = buildWerewolfViewerState(fullState(), 'wolf-1');
  expect(view.privateRole).toBe('werewolf');
  expect(view.knownWolfIds).toEqual(expect.arrayContaining(['wolf-2', 'wolf-3']));
  expect(JSON.stringify(view)).not.toContain('pendingWolfVotes');
});

test('游戏结束前公开观察视图不含任何身份，结束后公开全部身份', () => {
  expect(buildWerewolfViewerState(fullState(), undefined).seats.every((seat) => !seat.role)).toBe(true);
  expect(buildWerewolfViewerState(completedState(), undefined).seats.every((seat) => !!seat.role)).toBe(true);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --runInBand convex/werewolf/privacy.test.ts`

Expected: FAIL，提示找不到 `./privacy`。

- [ ] **Step 3: 实现最小查看者状态**

```ts
export type WerewolfViewerState = {
  phase: WerewolfPhase;
  round: number;
  seats: Array<Pick<WerewolfSeat, 'playerId' | 'displayName' | 'seatNumber' | 'alive'> & { role?: WerewolfRole }>;
  publicActions: WerewolfAction[];
  privateRole?: WerewolfRole;
  knownWolfIds?: string[];
  seerResults?: Array<{ targetId: string; camp: WerewolfCamp }>;
  witchNoticeTargetId?: string;
  antidoteAvailable?: boolean;
  poisonAvailable?: boolean;
  legalTargets: string[];
  pendingHumanAction?: WerewolfAction['kind'];
  winner?: WerewolfCamp | 'draw';
};

export function buildWerewolfViewerState(
  state: WerewolfState,
  viewerId?: string,
): WerewolfViewerState;
```

仅 `speech`、已结算的白天票型、公开离场与系统公告进入 `publicActions`；夜间动作在结束前永不公开。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npm test -- --runInBand convex/werewolf/privacy.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add convex/werewolf/privacy.ts convex/werewolf/privacy.test.ts
git commit -m "feat: isolate werewolf secret views"
```

---

### Task 5: Gemma 短发言与合法选择

**Files:**
- Create: `convex/werewolf/model.ts`
- Test: `convex/werewolf/model.test.ts`

- [ ] **Step 1: 写提示隔离和回退失败测试**

```ts
import { buildWerewolfPrompt, requestWerewolfAction } from './model';

test('提示只使用角色视图且不含全局状态字段', () => {
  const prompt = buildWerewolfPrompt(villagerView(), personality(), 'speech');
  expect(prompt).toContain('你是林澜');
  expect(prompt).not.toContain('wolf-2');
  expect(prompt).not.toContain('pendingNightTargetId');
});

test('模型空输出、泄露后台词和非法目标均使用规则回退', async () => {
  for (const content of ['', '{"text":"后台身份是狼人"}', '{"targetId":"not-alive"}']) {
    const result = await requestWerewolfAction(input(), depsReturning(content));
    expect(result.source).toBe('fallback');
  }
});

test('发言不超过八十字且不得使用血腥措辞', async () => {
  const result = await requestWerewolfAction(input(), depsReturning('{"text":"我暂时相信三号，再听一轮。"}'));
  expect(result).toEqual({ source: 'model', text: '我暂时相信三号，再听一轮。' });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --runInBand convex/werewolf/model.test.ts`

Expected: FAIL，提示找不到 `./model`。

- [ ] **Step 3: 实现串行本地模型适配器**

```ts
export type WerewolfModelResult = {
  source: 'model' | 'fallback';
  text?: string;
  targetId?: string;
  save?: boolean;
};

export function buildWerewolfPrompt(
  view: WerewolfViewerState,
  identity: string,
  requested: 'speech' | 'target' | 'witch',
): string;

export async function requestWerewolfAction(
  input: { view: WerewolfViewerState; identity: string; requested: 'speech' | 'target' | 'witch'; seedKey: string },
  dependencies = { getConfig: getLLMConfig, complete: localChatCompletionOnce },
): Promise<WerewolfModelResult>;
```

提示要求只输出 JSON，发言短而自然，不复读工作、河道、灯火或旧剧情。输出经过角色视图中的 `legalTargets`、80/40 字限制和安全词校验；失败时根据 `seedKey` 生成确定性中性发言或合法目标。

- [ ] **Step 4: 运行模型单测**

Run: `npm test -- --runInBand convex/werewolf/model.test.ts convex/util/llm.test.ts`

Expected: PASS，测试依赖注入，不真实调用 Ollama。

- [ ] **Step 5: 提交**

```bash
git add convex/werewolf/model.ts convex/werewolf/model.test.ts
git commit -m "feat: add isolated werewolf model decisions"
```

---

### Task 6: Convex 持久化、开局和人类操作

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/werewolf.ts`
- Test: `convex/werewolf.integration.test.ts`

- [ ] **Step 1: 写表结构和开局约束失败测试**

```ts
test('schema 包含三张狼人杀表和唯一动作索引', () => {
  expect(schemaSource).toContain('werewolfSessions: defineTable');
  expect(schemaSource).toContain('werewolfSeats: defineTable');
  expect(schemaSource).toContain('werewolfActions: defineTable');
  expect(schemaSource).toContain(".index('sessionKey', ['worldId', 'status'])");
  expect(schemaSource).toContain(".index('actionKey', ['sessionId', 'actionKey'])");
});

test('开局拒绝与进行中的每日活动或另一场狼人杀重叠', async () => {
  await expect(startWerewolfFixture({ runningDailyEvent: true })).rejects.toThrow(/活动|busy/iu);
  await expect(startWerewolfFixture({ runningWerewolf: true })).rejects.toThrow(/进行中|active/iu);
});

test('人类模式创建一名 human 和八名 ai，观察模式创建九名 ai', async () => {
  expect((await startWerewolfFixture({ mode: 'play' })).seats.filter((seat) => seat.kind === 'human')).toHaveLength(1);
  expect((await startWerewolfFixture({ mode: 'observe' })).seats.filter((seat) => seat.kind === 'human')).toHaveLength(0);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --runInBand convex/werewolf.integration.test.ts`

Expected: FAIL，表和 `startSession` 尚不存在。

- [ ] **Step 3: 添加专用表**

在 `convex/schema.ts` 添加：

```ts
werewolfSessions: defineTable({
  worldId: v.id('worlds'),
  status: v.union(v.literal('running'), v.literal('paused'), v.literal('completed')),
  phase: v.string(),
  round: v.number(),
  seed: v.number(),
  mode: v.union(v.literal('observe'), v.literal('play')),
  humanPlayerId: v.optional(playerId),
  nextActionAt: v.number(),
  winner: v.optional(v.string()),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
  updatedAt: v.number(),
}).index('worldId', ['worldId']).index('sessionKey', ['worldId', 'status']),

werewolfSeats: defineTable({
  sessionId: v.id('werewolfSessions'),
  playerId,
  displayName: v.string(),
  kind: v.union(v.literal('ai'), v.literal('human')),
  seatNumber: v.number(),
  role: v.string(),
  alive: v.boolean(),
  stateJson: v.string(),
}).index('sessionId', ['sessionId']).index('player', ['sessionId', 'playerId']),

werewolfActions: defineTable({
  sessionId: v.id('werewolfSessions'),
  actionKey: v.string(),
  sequence: v.number(),
  round: v.number(),
  phase: v.string(),
  actorId: v.optional(playerId),
  kind: v.string(),
  visibility: v.union(v.literal('public'), v.literal('private'), v.literal('system')),
  targetId: v.optional(playerId),
  text: v.optional(v.string()),
  source: v.union(v.literal('human'), v.literal('model'), v.literal('fallback'), v.literal('system')),
  createdAt: v.number(),
}).index('sessionId', ['sessionId']).index('actionKey', ['sessionId', 'actionKey']),
```

- [ ] **Step 4: 实现 Convex 入口与幂等动作写入**

在 `convex/werewolf.ts` 导出：

```ts
export const startSession = mutation({
  args: { worldId: v.id('worlds'), mode: v.union(v.literal('observe'), v.literal('play')) },
  handler: startWerewolfSession,
});

export const viewerState = query({
  args: { worldId: v.id('worlds') },
  handler: queryWerewolfViewerState,
});

export const submitHumanAction = mutation({
  args: {
    sessionId: v.id('werewolfSessions'),
    kind: v.union(v.literal('speech'), v.literal('target'), v.literal('witch')),
    text: v.optional(v.string()),
    targetId: v.optional(playerId),
    save: v.optional(v.boolean()),
  },
  handler: commitHumanWerewolfAction,
});
```

同文件实现三个处理函数：`startWerewolfSession` 按世界状态、活动冲突、九人名单、身份分配、表写入和首次调度的顺序执行；`queryWerewolfViewerState` 从三张表重建状态并调用隐私过滤器；`commitHumanWerewolfAction` 校验 `DEFAULT_NAME` 对应的人类座位、当前阶段和目标后写入唯一动作。公共 `viewerState` 对未参赛观察者只返回公开视图。`actionKey` 使用 `${sessionId}:${round}:${phase}:${actorId}`，同一动作最多写一次。

- [ ] **Step 5: 运行生成、类型与集成测试**

Run: `npx convex codegen && npm test -- --runInBand convex/werewolf.integration.test.ts && npm run build`

Expected: PASS，生成文件自动更新且 TypeScript 无错误。

- [ ] **Step 6: 提交**

```bash
git add convex/schema.ts convex/werewolf.ts convex/werewolf.integration.test.ts convex/_generated
git commit -m "feat: persist werewolf sessions and human actions"
```

---

### Task 7: 串行调度、暂停、超时和恢复

**Files:**
- Modify: `convex/werewolf.ts`
- Test: `convex/werewolf.scheduler.test.ts`

- [ ] **Step 1: 写 AI 串行和人类超时失败测试**

```ts
test('每次推进只调度一个 AI 行动', async () => {
  const result = await advanceFixture(aiTurn());
  expect(result.scheduledModelActions).toBe(1);
});

test('人类操作等待九十秒后使用安全默认值', async () => {
  const pending = await advanceFixture(humanTurn(), { now: 1000 });
  expect(pending.deadlineAt).toBe(91000);
  const expired = await advanceFixture(pending.state, { now: 91001 });
  expect(expired.lastAction.source).toBe('fallback');
});

test('小镇暂停时不调用模型且保留剩余等待时间', async () => {
  const result = await advanceFixture(aiTurn(), { worldStatus: 'stoppedByDeveloper' });
  expect(result.scheduledModelActions).toBe(0);
  expect(result.session.status).toBe('paused');
});

test('重复唤醒不会重复动作或奖励', async () => {
  const first = await advanceFixture(aiTurn());
  const second = await advanceFixture(first.state);
  expect(second.actions).toEqual(first.actions);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --runInBand convex/werewolf.scheduler.test.ts`

Expected: FAIL，内部调度入口尚不存在。

- [ ] **Step 3: 实现一个动作一个任务的调度器**

在 `convex/werewolf.ts` 增加：

```ts
export const advanceSession = internalMutation({
  args: { sessionId: v.id('werewolfSessions') },
  handler: advanceWerewolfSession,
});

export const generateAiAction = internalAction({
  args: { sessionId: v.id('werewolfSessions'), actorId: playerId, actionKey: v.string() },
  handler: generateWerewolfAiAction,
});

export const commitAiAction = internalMutation({
  args: { sessionId: v.id('werewolfSessions'), actorId: playerId, actionKey: v.string(), resultJson: v.string() },
  handler: commitWerewolfAiAction,
});
```

同文件实现 `advanceWerewolfSession`、`generateWerewolfAiAction` 和 `commitWerewolfAiAction`。前者重建状态并只选择一个待办动作；第二个只读取对应角色私密视图并调用模型；第三个先查 `actionKey`，不存在时才应用动作和调度下一步。AI 行动使用 `runAfter(0)` 串行；人类等待使用 `runAt(deadlineAt)`。每次入口先检查动作唯一键和世界状态。恢复时从表中重建状态，不依赖浏览器内存。

- [ ] **Step 4: 运行调度与暂停测试**

Run: `npm test -- --runInBand convex/werewolf.scheduler.test.ts convex/world.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add convex/werewolf.ts convex/werewolf.scheduler.test.ts
git commit -m "feat: run resilient werewolf turns"
```

---

### Task 8: 圆桌移动与地图表现

**Files:**
- Modify: `data/worlds/lighthouse-town/map.ts`
- Create: `convex/werewolf/movement.ts`
- Test: `convex/werewolf/movement.test.ts`
- Create: `src/components/WerewolfMapOverlay.tsx`
- Modify: `src/components/PixiGame.tsx`

- [ ] **Step 1: 写九座位与观众席可行走测试**

```ts
import { werewolfCheckpoints, objmap } from '../../data/worlds/lighthouse-town/map';
import { buildWerewolfMovementCommands } from './movement';

test('九个圆桌座位和观众席均唯一且可行走', () => {
  expect(new Set(werewolfCheckpoints.seats.map(({x,y}) => `${x}:${y}`)).size).toBe(9);
  for (const point of [...werewolfCheckpoints.seats, ...werewolfCheckpoints.spectators]) {
    expect(objmap[0][point.x][point.y]).toBe(-1);
  }
});

test('开局移动到对应座位，淘汰后移动到观众席', () => {
  expect(buildWerewolfMovementCommands(seats(), 'seating', 1000).map((entry) => entry.destination))
    .toEqual(werewolfCheckpoints.seats);
  expect(buildWerewolfMovementCommands(eliminatedSeats(), 'elimination', 2000)[0].description)
    .toContain('观众席');
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --runInBand convex/werewolf/movement.test.ts`

Expected: FAIL，`werewolfCheckpoints` 不存在。

- [ ] **Step 3: 导出固定地图点并生成移动命令**

在 `map.ts` 导出九个主镇广场周边可行走座位和四个观众席点：

```ts
export const werewolfCheckpoints = {
  center: { x: 22, y: 21 },
  seats: [
    { x: 20, y: 19 }, { x: 22, y: 19 }, { x: 24, y: 19 },
    { x: 25, y: 21 }, { x: 24, y: 23 }, { x: 22, y: 23 },
    { x: 20, y: 23 }, { x: 19, y: 21 }, { x: 20, y: 21 },
  ],
  spectators: [{ x: 17, y: 19 }, { x: 17, y: 21 }, { x: 17, y: 23 }, { x: 17, y: 25 }],
} as const;
```

若测试发现任一点被当前地图物体占用，仅调整到最近可行走整数格，不修改建筑。

`movement.ts` 返回现有 `eventMove` 可接受的 `{ residentId, destination, description, until }`，人类座位只显示覆盖层，不向 AI 专用移动输入发送命令。

- [ ] **Step 4: 增加 Pixi 圆桌覆盖层**

`WerewolfMapOverlay` 接收公开 `viewerState`，绘制圆桌、九个座位号、`夜晚/白天`色层、当前发言光圈、公开投票箭头和观众席。只显示服务端已公开字段，不在前端推断身份。

- [ ] **Step 5: 运行地图测试和前端构建**

Run: `npm test -- --runInBand convex/werewolf/movement.test.ts data/worlds/lighthouse-town/map.test.ts && npm run build`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add data/worlds/lighthouse-town/map.ts convex/werewolf/movement.ts convex/werewolf/movement.test.ts src/components/WerewolfMapOverlay.tsx src/components/PixiGame.tsx
git commit -m "feat: show werewolf round table on town map"
```

---

### Task 9: 观察台与人类私密操作界面

**Files:**
- Create: `src/components/werewolfView.ts`
- Test: `src/components/werewolfView.test.ts`
- Create: `src/components/WerewolfPanel.tsx`
- Modify: `src/components/EventBroadcast.tsx`
- Test: `src/components/EventBroadcast.test.ts`

- [ ] **Step 1: 写视图状态失败测试**

```ts
import { buildWerewolfPanelView } from './werewolfView';

test('未开局显示观察开局与加入游戏两个入口', () => {
  expect(buildWerewolfPanelView(undefined)).toEqual(expect.objectContaining({
    canStart: true, startLabels: ['作为观察者开局', '加入游戏'],
  }));
});

test('人类夜间操作只显示合法目标和自己的身份卡', () => {
  const view = buildWerewolfPanelView(humanSeerState());
  expect(view.privateCard?.roleLabel).toBe('预言家');
  expect(view.controls.kind).toBe('target');
  expect(view.controls.targets).toEqual(humanSeerState().legalTargets);
});

test('公开观察者看不到私密卡和夜间目标', () => {
  const view = buildWerewolfPanelView(publicState());
  expect(view.privateCard).toBeUndefined();
  expect(JSON.stringify(view)).not.toContain('witchNoticeTargetId');
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --runInBand src/components/werewolfView.test.ts`

Expected: FAIL，找不到 `./werewolfView`。

- [ ] **Step 3: 实现纯视图转换**

```ts
export type WerewolfPanelView = {
  canStart: boolean;
  startLabels: ['作为观察者开局', '加入游戏'];
  title: string;
  phaseLabel: string;
  roundLabel: string;
  privateCard?: { roleLabel: string; instructions: string };
  controls:
    | { kind: 'none' }
    | { kind: 'speech'; maxLength: number }
    | { kind: 'target'; targets: string[] }
    | { kind: 'witch'; targets: string[]; canSave: boolean; canPoison: boolean };
  publicTimeline: Array<{ sequence: number; text: string }>;
};

export function buildWerewolfPanelView(state?: WerewolfViewerState): WerewolfPanelView;
```

- [ ] **Step 4: 构建面板并接入观察台**

`WerewolfPanel` 使用 `api.werewolf.viewerState`、`startSession` 和 `submitHumanAction`。开始按钮必须显示忙碌状态并防双击；发言输入显示剩余字数；投票与技能目标使用明确按钮；私密身份卡默认折叠。公开时间线按服务端 sequence 排序。

在 `EventBroadcast.tsx` 的双日报卡之后、历史公共事件之前挂载 `<WerewolfPanel worldId={worldId} />`，不改变现有赛事折叠位置。

- [ ] **Step 5: 运行组件测试和构建**

Run: `npm test -- --runInBand src/components/werewolfView.test.ts src/components/EventBroadcast.test.ts && npm run build`

Expected: PASS；现有双日报和历史赛事断言保持通过。

- [ ] **Step 6: 提交**

```bash
git add src/components/werewolfView.ts src/components/werewolfView.test.ts src/components/WerewolfPanel.tsx src/components/EventBroadcast.tsx src/components/EventBroadcast.test.ts
git commit -m "feat: add playable werewolf observer panel"
```

---

### Task 10: 金贝、关系、日报和完整恢复验证

**Files:**
- Modify: `convex/townEconomy.ts`
- Modify: `convex/townEconomy.test.ts`
- Modify: `convex/townRelations.ts`
- Modify: `convex/townRelations.test.ts`
- Modify: `convex/events.ts`
- Modify: `src/components/socialObservationReport.ts`
- Modify: `src/components/socialObservationReport.test.ts`
- Modify: `src/components/reportExportController.ts`
- Modify: `src/components/reportExportController.test.ts`
- Create: `convex/werewolf.e2e.test.ts`

- [ ] **Step 1: 写幂等奖励和事实报告失败测试**

```ts
test('完成奖励五金贝且胜方再加二十，重复结算不重复入账', async () => {
  await settleWerewolfRewards(ctx, completedSession());
  await settleWerewolfRewards(ctx, completedSession());
  expect(ledgerFor('winner')).toEqual(expect.arrayContaining([
    expect.objectContaining({ amount: 5, sourceKey: expect.stringContaining(':participation:') }),
    expect.objectContaining({ amount: 20, sourceKey: expect.stringContaining(':winner:') }),
  ]));
  expect(totalAwardedTo('winner')).toBe(25);
});

test('事实流水账包含逐轮公开发言、票型和真实胜负', () => {
  const report = buildFactualReport(snapshotWithWerewolf());
  expect(report).toContain('狼人杀第 1 天');
  expect(report).toContain('公开投票');
  expect(report).toContain('好人阵营获胜');
});

test('社会观察只把联盟和跟票写成有证据的观察，不泄露当时未知身份', () => {
  const report = buildSocialObservationReport(snapshotWithWerewolf());
  expect(report).toContain('证据');
  expect(report).not.toContain('居民当时已经知道全部狼人');
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --runInBand convex/townEconomy.test.ts convex/townRelations.test.ts src/components/socialObservationReport.test.ts src/components/reportExportController.test.ts`

Expected: FAIL，新结算与狼人杀报告输入尚未实现。

- [ ] **Step 3: 接入经济和关系**

在 `townEconomy.ts` 导出：

```ts
export async function settleWerewolfRewards(
  ctx: EconomyDbContext,
  args: { worldId: Id<'worlds'>; sessionId: Id<'werewolfSessions'>; winner: 'wolves' | 'good'; now: number },
): Promise<{ participationPaid: number; winnerPaid: number }>;
```

仅 AI 居民获得奖励；使用 `werewolf:${sessionId}:participation:${residentId}` 和 `werewolf:${sessionId}:winner:${residentId}` 作为唯一流水键。

在 `townRelations.ts` 增加 `recordWerewolfRelationshipEvidence`，只消费公开动作：保护性发言、明确指控、公开投票和赛后公开阵营。每对居民单局友情/信任变化绝对值不超过 3；不写恋爱变化。

- [ ] **Step 4: 接入报告快照**

扩展现有观察快照，最多读取最近一场会话及 300 条公开动作。事实报告按 sequence 输出；社会观察使用公开证据键引用动作，不分析夜间私密选择。旧历史赛事仍保持原位置与折叠行为。

- [ ] **Step 5: 添加完整九人局与恢复测试**

`werewolf.e2e.test.ts` 使用确定性模型依赖跑完：

```ts
test('九位 AI 从开局运行到好人胜利并只结算一次', async () => {
  const result = await runDeterministicGame({ mode: 'observe', winner: 'good' });
  expect(result.session.status).toBe('completed');
  expect(result.session.winner).toBe('good');
  expect(result.publicReplay.length).toBeGreaterThan(20);
  expect(result.duplicateActionKeys).toEqual([]);
  expect(result.duplicateLedgerKeys).toEqual([]);
});

test('人类中途关闭页面后由九十秒超时继续并完成', async () => {
  const result = await runDeterministicGame({ mode: 'play', humanResponds: false });
  expect(result.session.status).toBe('completed');
  expect(result.actions.some((action) => action.source === 'fallback')).toBe(true);
});
```

- [ ] **Step 6: 运行完整验证**

Run: `npm test -- --runInBand && npm run build && git diff --check`

Expected: 全部测试 PASS，Vite 构建完成，无空白差异错误。

- [ ] **Step 7: 本地部署与浏览器验收**

Run: `npx convex run world:defaultWorldStatus '{}' --push --typecheck=disable`

重启 4174 预览服务后验收：

1. 观察开局可以完成至少一个夜晚和一轮白天；
2. 加入游戏显示私密身份且公开面板不泄密；
3. 人类发言、投票或夜间技能成功推进；
4. 地图九人不堆叠，淘汰者进入观众席；
5. 暂停后没有新模型请求，恢复后继续；
6. 事实流水账和社会观察日志包含本局记录。

- [ ] **Step 8: 提交和推送**

```bash
git add convex src data docs
git commit -m "feat: complete playable lighthouse town werewolf"
git push fork codex/daily-town-implementation
```

---

## 完成条件

- 九 AI 局和八 AI 加一人类局均可结束；
- 同一 Gemma 12B 的九个角色无秘密串线；
- 人类拥有合法私密操作且离线不阻塞；
- 地图、公开直播、赛后复盘、金贝、关系和双日报使用同一组持久化事实；
- 暂停、重连、重复调度和本地模型失败均不会重复动作或卡住世界；
- 全量测试、生产构建、本地站点验收与 Git 推送完成。
