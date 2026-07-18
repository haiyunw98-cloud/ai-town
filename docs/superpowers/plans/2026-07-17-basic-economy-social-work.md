# Basic Economy, Social Relations and Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make nine residents and nine institutions participate in a persistent, auditable loop of work, production, wages, consumption, institution income and event-driven social relationship change.

**Architecture:** Static definitions provide initial residents, jobs, institutions, goods and prices. Convex tables store mutable accounts, institution stock, immutable ledger rows and pairwise relationship dimensions. Activity completion schedules an idempotent settlement that verifies location before changing money or stock; conversation and cooperation boundaries write similarly idempotent relationship changes. UI dossiers and landmark cards query dynamic state with static profiles only as initialization fallback.

**Autonomy constraint:** Profiles, needs and starting relationships are initial conditions, not scripts. The local resident model chooses among currently feasible work, rest, consumption, cooperation, trade and social actions. Deterministic rules may reject impossible or unsafe actions and settle their consequences, but must not force one ordinary action or preselect who can become friends, partners or business collaborators. Every realized choice and consequence is recorded; unrealized model intentions are not reported as facts.

**Tech Stack:** TypeScript, Convex schema/mutations/queries/scheduler, existing AI Town activity engine, React, Jest.

---

## File structure

- Create `data/worlds/lighthouse-town/economy.ts` and `.test.ts`: jobs, goods, prices, institutions and starting balances.
- Create `convex/townEconomyRules.ts` and `.test.ts`: pure settlement, needs and reward rules.
- Modify `convex/schema.ts`: resident economy, institutions, ledger, relationships and relation-change tables.
- Create `convex/townEconomy.ts` and `convex/townEconomy.test.ts`: idempotent initialization, activity settlement, daily restock, rewards and queries.
- Create `convex/townRelations.ts` and `.test.ts`: pair initialization and evidence-based bounded changes.
- Modify `convex/init.ts`: initialize economic/social state without duplicates.
- Modify `convex/aiTown/agentOperations.ts`: needs-aware activity choice, scheduled activity settlement and conversation settlement.
- Modify `data/worlds/lighthouse-town/activities.ts`: explicit `economicAction` metadata.
- Modify `convex/lives.ts`, `src/components/ResidentDossier.tsx` and tests: dynamic balances, day flow and relations.
- Modify `src/components/TownLandmarks.tsx`, create `src/components/InstitutionDetails.tsx` and tests, modify `Game.tsx`/CSS: meaningful institution details.
- Modify reports/evidence tests: ledger and relationship changes in both reports.
- Modify `README.md`: rules, pause behavior, idempotency and limitations.

### Task 1: Define the nine-resident and nine-institution economy

**Files:**
- Create: `data/worlds/lighthouse-town/economy.ts`
- Create: `data/worlds/lighthouse-town/economy.test.ts`

- [ ] **Step 1: Write failing definition tests**

```ts
import { goods, institutions, residentEconomyProfiles } from './economy';
import { lighthouseCharacters } from './characters';
import { townLandmarks } from './map';

test('defines every resident and institution exactly once', () => {
  expect(residentEconomyProfiles.map((entry) => entry.name).sort()).toEqual(
    lighthouseCharacters.map((entry) => entry.name['zh-CN']).sort(),
  );
  expect(institutions.map((entry) => entry.landmarkId).sort()).toEqual(
    townLandmarks.map((entry) => entry.id).sort(),
  );
  expect(new Set(residentEconomyProfiles.map((entry) => entry.id)).size).toBe(9);
  expect(new Set(institutions.map((entry) => entry.id)).size).toBe(9);
});

test('uses positive bounded prices and no mystery jobs', () => {
  expect(goods.map((entry) => entry.id)).toEqual(['meal', 'tea', 'medicine', 'daily-goods', 'craft-service']);
  expect(goods.every((entry) => entry.price > 0 && entry.price <= 20)).toBe(true);
  expect(JSON.stringify({ institutions, residentEconomyProfiles })).not.toMatch(
    /海潮|航标|夜航|异常|谜团|线索/u,
  );
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand data/worlds/lighthouse-town/economy.test.ts`

Expected: FAIL because the definitions are absent.

- [ ] **Step 3: Implement the definitions**

```ts
export const goods = [
  { id: 'meal', name: '餐食', price: 6 },
  { id: 'tea', name: '茶点', price: 4 },
  { id: 'medicine', name: '常用药', price: 10 },
  { id: 'daily-goods', name: '日用品', price: 8 },
  { id: 'craft-service', name: '工艺服务', price: 12 },
] as const;
export type GoodId = typeof goods[number]['id'];

export const institutions = [
  { id: 'academy', landmarkId: 'academy', name: '灯塔书院', goods: [] },
  { id: 'herb-clinic', landmarkId: 'herb-clinic', name: '白露药庐', goods: ['medicine'] },
  { id: 'old-dock', landmarkId: 'old-dock', name: '旧水码头', goods: ['craft-service'] },
  { id: 'divination-hall', landmarkId: 'divination-hall', name: '听雨卦馆', goods: ['craft-service'] },
  { id: 'tea-house', landmarkId: 'tea-house', name: '听雨茶庄', goods: ['tea'] },
  { id: 'morning-market', landmarkId: 'morning-market', name: '晨市', goods: ['daily-goods', 'meal'] },
  { id: 'town-office', landmarkId: 'town-office', name: '镇公所', goods: [] },
  { id: 'workshop', landmarkId: 'workshop', name: '苏氏工坊', goods: ['craft-service'] },
  { id: 'restaurant', landmarkId: 'restaurant', name: '临水食肆', goods: ['meal'] },
] as const;
```

Define all nine resident profiles with `id`, `name`, `occupation`, `institutionId`, `employment: 'employee' | 'self-employed'`, `startingBalance` between 80–160, `compensation` (`wage`, `owner-draw`, or `contract-share`) between 8–16 with institution-cash capping, and a discriminated stock-or-service `workOutput`. Use the existing character IDs as resident IDs. Every service output must have an institution-supported service counter; every stock output must have an institution-supported goods key.

- [ ] **Step 4: Run definitions tests and verify GREEN**

Run: `npm test -- --runInBand data/worlds/lighthouse-town/economy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit definitions**

```bash
git add data/worlds/lighthouse-town/economy.ts data/worlds/lighthouse-town/economy.test.ts
git commit -m "feat: define the town economy and jobs"
```

### Task 2: Implement pure monetary, stock, needs and event-reward rules

**Files:**
- Create: `convex/townEconomyRules.ts`
- Create: `convex/townEconomyRules.test.ts`

- [ ] **Step 1: Write failing rule tests**

```ts
import { settlePurchase, settleWork, eventReward, chooseNeed } from './townEconomyRules';

test('settles work without negative values', () => {
  expect(settleWork({ residentBalance: 100, institutionCash: 200, stock: 4 }, { pay: 12, output: 2 }))
    .toEqual({ residentBalance: 112, institutionCash: 188, stock: 6 });
});

test('settles a purchase atomically and refuses insufficient funds or stock', () => {
  expect(settlePurchase({ residentBalance: 20, institutionCash: 30, stock: 3 }, { price: 6, quantity: 1 }))
    .toEqual({ ok: true, residentBalance: 14, institutionCash: 36, stock: 2 });
  expect(settlePurchase({ residentBalance: 2, institutionCash: 30, stock: 3 }, { price: 6, quantity: 1 }).ok)
    .toBe(false);
});

test('pays fixed cumulative daily event rewards', () => {
  expect(eventReward({ participated: true, finalist: false, champion: false })).toBe(10);
  expect(eventReward({ participated: true, finalist: true, champion: false })).toBe(30);
  expect(eventReward({ participated: true, finalist: true, champion: true })).toBe(80);
});

test('exposes urgent needs without choosing an ordinary action for the resident', () => {
  expect(availableNeeds({ hunger: 15, energy: 80, balance: 20 })).toContain('food');
  expect(availableNeeds({ hunger: 70, energy: 15, balance: 20 })).toContain('rest');
  expect(availableNeeds({ hunger: 70, energy: 80, balance: 20 })).toEqual(['normal']);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/townEconomyRules.test.ts`

Expected: FAIL because rules are absent.

- [ ] **Step 3: Implement pure clamped rules**

```ts
export function settleWork(state: { residentBalance: number; institutionCash: number; stock: number }, input: { pay: number; output: number }) {
  const paid = Math.min(state.institutionCash, Math.max(0, input.pay));
  return { residentBalance: state.residentBalance + paid, institutionCash: state.institutionCash - paid, stock: state.stock + Math.max(0, input.output) };
}

export function settlePurchase(state: { residentBalance: number; institutionCash: number; stock: number }, input: { price: number; quantity: number }) {
  const total = input.price * input.quantity;
  if (total <= 0 || state.residentBalance < total || state.stock < input.quantity) return { ok: false as const, ...state };
  return { ok: true as const, residentBalance: state.residentBalance - total, institutionCash: state.institutionCash + total, stock: state.stock - input.quantity };
}

export function eventReward(input: { participated: boolean; finalist: boolean; champion: boolean }) {
  return (input.participated ? 10 : 0) + (input.finalist ? 20 : 0) + (input.champion ? 50 : 0);
}

export function availableNeeds(input: { hunger: number; energy: number; balance: number }) {
  const needs: Array<'food' | 'rest' | 'normal'> = [];
  if (input.hunger < 30 && input.balance >= 4) needs.push('food');
  if (input.energy < 30) needs.push('rest');
  return needs.length ? needs : ['normal'];
}
```

- [ ] **Step 4: Run rules tests and verify GREEN**

Run: `npm test -- --runInBand convex/townEconomyRules.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit pure rules**

```bash
git add convex/townEconomyRules.ts convex/townEconomyRules.test.ts
git commit -m "feat: add deterministic town economy rules"
```

### Task 3: Persist accounts, institutions and immutable ledger rows

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/townEconomy.ts`
- Create: `convex/townEconomy.test.ts`
- Modify: `convex/init.ts`

- [ ] **Step 1: Write failing schema and initialization tests**

```ts
test('declares all persistent economy tables and unique indexes', () => {
  const schema = readFileSync('convex/schema.ts', 'utf8');
  expect(schema).toContain('residentEconomy: defineTable');
  expect(schema).toContain('townInstitutions: defineTable');
  expect(schema).toContain('economyLedger: defineTable');
  expect(schema).toContain(".index('idempotencyKey'");
});

test('initializes nine residents and nine institutions once', async () => {
  await initializeTownEconomy(ctx, worldId);
  await initializeTownEconomy(ctx, worldId);
  expect(await countRows(ctx, 'residentEconomy')).toBe(9);
  expect(await countRows(ctx, 'townInstitutions')).toBe(9);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/townEconomy.test.ts`

Expected: FAIL because tables and initialization are absent.

- [ ] **Step 3: Add persistent tables**

```ts
residentEconomy: defineTable({
  worldId: v.id('worlds'), residentId: playerId, profileId: v.string(),
  balance: v.number(), hunger: v.number(), energy: v.number(),
  todayIncome: v.number(), todayExpense: v.number(), dayKey: v.string(), updatedAt: v.number(),
}).index('resident', ['worldId', 'residentId']),
townInstitutions: defineTable({
  worldId: v.id('worlds'), institutionId: v.string(), cash: v.number(),
  stockJson: v.string(), todayIncome: v.number(), todayExpense: v.number(),
  visitorCount: v.number(), dayKey: v.string(), updatedAt: v.number(),
}).index('institution', ['worldId', 'institutionId']),
economyLedger: defineTable({
  worldId: v.id('worlds'), idempotencyKey: v.string(), dayKey: v.string(),
  residentId: v.optional(playerId), institutionId: v.optional(v.string()),
  kind: v.union(v.literal('work'), v.literal('purchase'), v.literal('restock'), v.literal('event-reward'), v.literal('event-service')),
  amount: v.number(), item: v.optional(v.string()), quantity: v.optional(v.number()),
  sourceKey: v.string(), text: v.string(), createdAt: v.number(),
}).index('idempotencyKey', ['worldId', 'idempotencyKey']).index('day', ['worldId', 'dayKey', 'createdAt']),
```

Implement `initializeTownEconomy` by resolving runtime player IDs from profile names, checking each indexed row before insert, using 120 institution cash and stock `{ meal: 12, tea: 12, medicine: 8, 'daily-goods': 10, 'craft-service': 99 }`. Call it from `init` after missing residents are queued and again from the periodic settlement path so delayed player creation is covered.

- [ ] **Step 4: Run economy persistence tests**

Run: `npm test -- --runInBand convex/townEconomy.test.ts`

Expected: PASS with duplicate initialization suppressed.

- [ ] **Step 5: Commit persistence**

```bash
git add convex/schema.ts convex/townEconomy.ts convex/townEconomy.test.ts convex/init.ts
git commit -m "feat: persist town accounts institutions and ledger"
```

### Task 4: Settle completed work and consumption at real locations

**Files:**
- Modify: `data/worlds/lighthouse-town/activities.ts`
- Modify: `data/worlds/lighthouse-town/activities.test.ts`
- Modify: `convex/townEconomy.ts`
- Modify: `convex/townEconomy.test.ts`
- Modify: `convex/aiTown/agentOperations.ts`

- [ ] **Step 1: Write failing location and idempotency tests**

```ts
test('settles a completed work activity once only at the matching institution', async () => {
  const args = workSettlementFixture({ distanceFromDestination: 0 });
  await settleActivity(ctx, args);
  await settleActivity(ctx, args);
  expect(await residentBalance(ctx, args.residentId)).toBe(112);
  expect(await ledgerByKey(ctx, args.idempotencyKey)).toHaveLength(1);
});

test('does not pay work that never reached the institution', async () => {
  await settleActivity(ctx, workSettlementFixture({ distanceFromDestination: 5 }));
  expect(await residentBalance(ctx, residentId)).toBe(100);
});

test('an eating activity transfers money and stock atomically', async () => {
  await settleActivity(ctx, foodSettlementFixture());
  expect(await residentState(ctx)).toMatchObject({ balance: 94, hunger: 80 });
  expect(await institutionState(ctx)).toMatchObject({ cash: 126 });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/townEconomy.test.ts data/worlds/lighthouse-town/activities.test.ts`

Expected: FAIL because activity metadata and settlement are absent.

- [ ] **Step 3: Add explicit economic metadata and scheduled settlement**

Extend `ResidentActivity` with:

```ts
economicAction?:
  | { kind: 'work'; institutionId: string; output: number }
  | { kind: 'purchase'; institutionId: string; goodId: GoodId; quantity: 1 }
  | { kind: 'rest' };
```

Every resident gets at least one work activity at the profile institution, one food purchase at the tea house, market or restaurant, and one rest action. In `agentDoSomething`, schedule `internal.townEconomy.settleActivity` at `activity.until` with `idempotencyKey: activity:<worldId>:<residentId>:<operationId>`. Settlement queries the current world player, verifies matching activity text and distance no greater than two tiles from the landmark destination, applies pure rules, inserts one ledger row and records a factual life event. If world status is not `running`, return without changes.

- [ ] **Step 4: Run activity/economy tests**

Run: `npm test -- --runInBand convex/townEconomy.test.ts data/worlds/lighthouse-town/activities.test.ts`

Expected: PASS including pause and insufficient-funds fixtures.

- [ ] **Step 5: Commit live settlements**

```bash
git add data/worlds/lighthouse-town/activities.ts data/worlds/lighthouse-town/activities.test.ts convex/townEconomy.ts convex/townEconomy.test.ts convex/aiTown/agentOperations.ts
git commit -m "feat: settle real work and consumption activities"
```

### Task 5: Add daily restock and autonomy-aware feasible activity choice

**Files:**
- Modify: `convex/townEconomy.ts`
- Modify: `convex/townEconomy.test.ts`
- Modify: `convex/crons.ts`
- Modify: `convex/aiTown/agentOperations.ts`

- [ ] **Step 1: Write failing daily and need-priority tests**

```ts
test('restocks once per Shanghai day and never while paused', async () => {
  await advanceDailyEconomy(ctx, timestamp('2026-07-17T00:01:00+08:00'));
  await advanceDailyEconomy(ctx, timestamp('2026-07-17T08:01:00+08:00'));
  expect(await ledgerKindCount(ctx, 'restock')).toBe(9);
  await pauseWorld(ctx);
  await advanceDailyEconomy(ctx, timestamp('2026-07-18T00:01:00+08:00'));
  expect(await ledgerKindCount(ctx, 'restock')).toBe(9);
});

test('keeps multiple feasible choices and exposes needs as model context', () => {
  const view = feasibleActivitiesForState('唐果', { hunger: 20, energy: 90, balance: 40 });
  expect(view.needs).toContain('food');
  expect(view.activities.map((entry) => entry.category)).toEqual(expect.arrayContaining(['food', 'work', 'social']));
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/townEconomy.test.ts data/worlds/lighthouse-town/activities.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement idempotent daily advance and state-aware selection**

Add a 60-second cron calling `advanceDailyEconomy`. On the first running check for a new Shanghai day, reset daily income/expense/visitor counts, charge a fixed two-gold institution cost, and restore configured stock up to its cap with one ledger row per institution. Expose an internal resident-state query and build a finite set of feasible actions plus needs context for the local resident model. Normal needs never force a single action; only impossible actions (for example an unaffordable purchase or closed institution) are removed. Critical health/safety thresholds may trigger a bounded fallback. Decrease hunger and energy by one on each successful settlement, clamped to 0–100.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --runInBand convex/townEconomy.test.ts data/worlds/lighthouse-town/activities.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit daily economy and need selection**

```bash
git add convex/townEconomy.ts convex/townEconomy.test.ts convex/crons.ts convex/aiTown/agentOperations.ts data/worlds/lighthouse-town/activities.ts data/worlds/lighthouse-town/activities.test.ts
git commit -m "feat: advance daily stock and resident needs"
```

### Task 6: Persist evidence-based dynamic relationships

**Files:**
- Create: `convex/townRelations.ts`
- Create: `convex/townRelations.test.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/init.ts`
- Modify: `convex/aiTown/agentOperations.ts`

- [ ] **Step 1: Write failing relationship tests**

```ts
test('initializes one undirected pair and preserves four dimensions', async () => {
  await initializeTownRelations(ctx, worldId);
  expect(await relationshipPairCount(ctx)).toBe(36);
  expect(await relation(ctx, 'lin-lan', 'tang-guo')).toMatchObject({
    friendship: expect.any(Number), trust: expect.any(Number),
    attraction: expect.any(Number), business: expect.any(Number),
  });
});

test('applies conversation changes once with a daily pair cap', async () => {
  await recordRelationEvent(ctx, conversationFixture('c:1'));
  await recordRelationEvent(ctx, conversationFixture('c:1'));
  expect(await relationChangeCount(ctx)).toBe(1);
  expect((await relation(ctx, first, second)).friendship).toBe(initialFriendship + 1);
});

test('allows adult relationships to emerge only from reciprocal evidence', async () => {
  await recordRelationEvent(ctx, { ...careFixture(), attractionDelta: 1, reciprocal: false });
  expect((await relation(ctx, first, second)).attraction).toBe(initialAttraction);
  await recordRelationEvent(ctx, { ...careFixture('c:2'), attractionDelta: 1, reciprocal: true });
  expect((await relation(ctx, first, second)).attraction).toBe(initialAttraction + 1);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/townRelations.test.ts`

Expected: FAIL because relationship persistence is absent.

- [ ] **Step 3: Add relationship tables and mutations**

```ts
townRelationships: defineTable({
  worldId: v.id('worlds'), residentA: playerId, residentB: playerId,
  friendship: v.number(), trust: v.number(), attraction: v.number(), business: v.number(),
  updatedAt: v.number(),
}).index('pair', ['worldId', 'residentA', 'residentB']),
relationshipChanges: defineTable({
  worldId: v.id('worlds'), idempotencyKey: v.string(), residentA: playerId, residentB: playerId,
  kind: v.union(v.literal('conversation'), v.literal('cooperation'), v.literal('trade'), v.literal('care'), v.literal('dispute')),
  friendshipDelta: v.number(), trustDelta: v.number(), attractionDelta: v.number(), businessDelta: v.number(),
  sourceKey: v.string(), text: v.string(), createdAt: v.number(),
}).index('idempotencyKey', ['worldId', 'idempotencyKey']).index('pairTime', ['worldId', 'residentA', 'residentB', 'createdAt']),
```

Always sort pair IDs before lookup. Initialize the 36 adult resident pairs from static profile scores; dimensions without a configured signal start at 40 friendship, 40 trust, 0 attraction and 20 business. Static hooks are starting context, never permanent eligibility gates. Conversation alone records contact but does not automatically improve a relationship. Cooperation, trade, care, reciprocal affection and explicit disputes create small evidence-based changes, with pair/day caps and all values clamped to 0–100. Attraction may emerge for any adult pair only from reciprocal, explicit interaction evidence; no model narration by itself changes it. Call conversation settlement after `rememberConversation`; use `conversation:<worldId>:<conversationId>:pair` so the two agents cannot double-record it.

- [ ] **Step 4: Run relationship tests**

Run: `npm test -- --runInBand convex/townRelations.test.ts`

Expected: PASS with all values clamped to 0–100.

- [ ] **Step 5: Commit dynamic relationships**

```bash
git add convex/townRelations.ts convex/townRelations.test.ts convex/schema.ts convex/init.ts convex/aiTown/agentOperations.ts
git commit -m "feat: evolve resident relationships from real events"
```

### Task 7: Show dynamic economy, relations and institution use

**Files:**
- Modify: `convex/lives.ts`
- Modify: `convex/lives.test.ts`
- Modify: `src/components/ResidentDossier.tsx`
- Modify: `src/components/ResidentDossier.test.ts`
- Modify: `src/components/TownLandmarks.tsx`
- Create: `src/components/InstitutionDetails.tsx`
- Create: `src/components/InstitutionDetails.test.ts`
- Modify: `src/components/Game.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Add failing dossier and institution tests**

```ts
test('resident dossier returns real money flow and dynamic relation changes', async () => {
  const dossier = await residentDossierHandler(ctx, { worldId, playerId });
  expect(dossier.economy).toMatchObject({ balance: 112, todayIncome: 12, todayExpense: 0 });
  expect(dossier.relationships[0]).toHaveProperty('recentChange');
});

test('renders institution stock, visitors and daily cash flow', () => {
  render(<InstitutionDetails institution={fixtureInstitution} />);
  expect(screen.getByText('今日收入')).toBeTruthy();
  expect(screen.getByText('今日客流')).toBeTruthy();
  expect(screen.getByText('餐食 × 8')).toBeTruthy();
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/lives.test.ts src/components/ResidentDossier.test.ts src/components/InstitutionDetails.test.ts`

Expected: FAIL because dynamic fields and institution details are absent.

- [ ] **Step 3: Query and render live state**

Join the resident economy row, last five ledger entries, relationship rows and last relation changes in `residentDossier`. Replace derived finance display with real balance and day flow while retaining mood/health as bounded display attributes. Add `townEconomy.institutionDetails` query returning name, description, services, stock, cash, day flow and visitors. Clicking a landmark opens `InstitutionDetails` above the observer footer; closing restores the previous tab without moving the resident.

- [ ] **Step 4: Run UI/query tests and build**

Run: `npm test -- --runInBand convex/lives.test.ts src/components/ResidentDossier.test.ts src/components/InstitutionDetails.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit dynamic UI**

```bash
git add convex/lives.ts convex/lives.test.ts src/components/ResidentDossier.tsx src/components/ResidentDossier.test.ts src/components/TownLandmarks.tsx src/components/InstitutionDetails.tsx src/components/InstitutionDetails.test.ts src/components/Game.tsx src/index.css
git commit -m "feat: expose live resident and institution economy"
```

### Task 8: Add economy and relationship evidence to both reports

**Files:**
- Modify: `convex/events.ts`
- Modify: `src/components/eventBroadcastView.ts`
- Modify: `src/components/socialEvidence.ts`
- Modify corresponding tests
- Modify: `README.md`

- [ ] **Step 1: Add failing report evidence tests**

```ts
test('fact report records exact economic and relationship changes', () => {
  const report = buildFactualReport(economyFixture);
  expect(report).toContain('唐果｜工作收入 +12 金贝｜听雨茶庄');
  expect(report).toContain('唐果 ↔ 沈砚｜友情 +1｜证据 conversation:c:4');
});

test('social evidence analyzes labor commerce and relations without inventing motives', () => {
  const bundle = buildSocialEvidence(economyFixture);
  expect(bundle.evidence.some((entry) => entry.category === 'labor-commerce')).toBe(true);
  expect(bundle.evidence.some((entry) => entry.category === 'relationship-signal')).toBe(true);
  expect(JSON.stringify(bundle)).not.toMatch(/因为.*想要|内心|人格/u);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand src/components/socialEvidence.test.ts src/components/socialObservationReport.test.ts src/components/EventBroadcast.test.ts`

Expected: FAIL because snapshots omit ledger and relation changes.

- [ ] **Step 3: Extend the immutable daily snapshot and renderers**

Add `dailyEconomyLedger`, `institutionStates` and `dailyRelationshipChanges` to `observerSnapshot`, bounded to the current Shanghai day and sorted chronologically. Add exact facts to the factual ledger and aggregate amount/count/institution/pair evidence to the social bundle. Do not infer salary or relationship changes from prose when no ledger row exists.

- [ ] **Step 4: Run full economy/report verification**

Run: `npm test -- --runInBand data/worlds/lighthouse-town/economy.test.ts convex/townEconomyRules.test.ts convex/townEconomy.test.ts convex/townRelations.test.ts convex/lives.test.ts src/components/ResidentDossier.test.ts src/components/InstitutionDetails.test.ts src/components/socialEvidence.test.ts src/components/socialObservationReport.test.ts src/components/EventBroadcast.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 5: Document and commit**

Document currency, jobs, stock, needs, relationship rules, pause behavior, event reward amounts and non-goals.

```bash
git add convex/events.ts src/components/eventBroadcastView.ts src/components/socialEvidence.ts src/components README.md
git commit -m "feat: report the town economy and social changes"
```
