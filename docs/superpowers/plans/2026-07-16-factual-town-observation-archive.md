# Complete Factual Daily Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing Markdown download into a complete factual daily report using only current local records.

**Architecture:** Extend the existing observer snapshot with recent raw messages, then build one deterministic Markdown string in `eventBroadcastView.ts`. Keep the existing one-click browser download and avoid new tables, samplers, ZIP libraries, background jobs, or report persistence.

**Tech Stack:** TypeScript, Convex, React, Jest.

---

## Task 1: Expose enough existing facts for a full report

**Files:**
- Modify: `convex/events.ts`
- Modify: `src/components/eventBroadcastView.ts`
- Modify: `src/components/EventBroadcast.test.ts`

- [ ] **Step 1: Add a failing test for raw daily messages**

Extend the `BroadcastSnapshot` fixture with:

```ts
dailyMessages: [
  {
    messageId: 'm:1', conversationId: 'c:1', authorId: 'p:1', authorName: '顾潮',
    text: '今晚去机关坊试灯。', createdAt: 21_000, observerIntervention: false,
  },
]
```

Assert that the future report includes the original message and author.

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts`  
Expected: FAIL because `BroadcastSnapshot` does not contain `dailyMessages` and the report does not render it.

- [ ] **Step 3: Extend the existing snapshot query**

In `convex/events.ts`, reuse the existing `messages` query but take up to 500 recent messages. Return this additional field without changing current conversation cards:

```ts
dailyMessages: messages.map((message) => ({
  messageId: String(message._id),
  conversationId: message.conversationId,
  authorId: message.author,
  authorName: names.get(message.author) ?? (message.author.startsWith('p:') ? '居民' : '观察者'),
  text: message.text,
  createdAt: message._creationTime,
  observerIntervention: !names.has(message.author),
})),
```

Increase the existing life-event cap from 200 to 500. Add `dailyMessages: []` to the no-world return. Extend `BroadcastSnapshot` with the exact message shape above.

- [ ] **Step 4: Verify the focused test and compiler**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts && npx tsc --noEmit`  
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add convex/events.ts src/components/eventBroadcastView.ts src/components/EventBroadcast.test.ts
git commit -m "feat: expose complete daily town records"
```

## Task 2: Generate the complete factual Markdown

**Files:**
- Modify: `src/components/eventBroadcastView.ts`
- Modify: `src/components/EventBroadcast.test.ts`

- [ ] **Step 1: Write failing section and factual-boundary tests**

Add a fixture containing two residents, life events, relationship settings, a location activity, a conversation, raw messages, and a completed town event. Assert:

```ts
const report = buildDailyReport(snapshot, 'zh-CN', now);
for (const heading of [
  '日报元数据', '全镇事实概览', '居民逐人记录', '关系记录', '机构与地点',
  '活动分类', '当日对话', '赛事与公共事件', '生活记录附录',
  '原始对话附录', '数据说明',
]) expect(report).toContain(`## ${heading}`);
expect(report).toContain('人物设定关系');
expect(report).toContain('当日实际互动');
expect(report).toContain('观察者介入');
expect(report).toContain('当日无记录');
expect(report).not.toMatch(/因此导致|内心认为|形成派系|社会中心|证明了/);
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts`  
Expected: FAIL because the existing report is shorter and lacks the required sections.

- [ ] **Step 3: Implement the deterministic report**

Import `residentLifeProfiles` and `townLandmarks`. Add `sameLocalDay(timestamp, now)` and filter `dailyLifeEvents`, `dailyMessages`, conversations, and logs to the selected Shanghai/browser date.

Build sections in this exact order:

```ts
const sections = [
  renderMetadata(snapshot, dayFacts, locale, now),
  renderTownOverview(snapshot, dayFacts),
  renderResidents(snapshot, dayFacts),
  renderRelationships(dayFacts),
  renderLandmarks(dayFacts),
  renderActivityCategories(dayFacts),
  renderConversations(dayFacts),
  renderPublicEvents(snapshot, dayFacts),
  renderLifeEventAppendix(dayFacts),
  renderRawMessageAppendix(dayFacts),
  renderDataNotes(dayFacts),
];
return [`# 灯塔镇完整观察日报`, '', ...sections].join('\n');
```

Implementation rules:

- Resident profiles come from `residentLifeProfiles`; current status comes from `residentActivity`.
- Per-resident activity and raw message lists use resident IDs when available, then names as fallback.
- Relationship settings render all profile relationships under `人物设定关系`.
- Actual interaction lists conversation participants and message counts under `当日实际互动`; it never changes relationship scores.
- Institution use matches explicit `在${landmark.name}` text; every landmark still renders its introduction and services.
- Activity classification uses existing `dailyLifeEvents.kind`; unknown kinds render under `其他`.
- Conversation summary is the existing deterministic summary; raw message appendix preserves cleaned line breaks but does not remove content.
- Missing arrays render `- 当日无记录`.
- Public event status and winner are copied from the snapshot without causal language.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts`  
Expected: all report tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/eventBroadcastView.ts src/components/EventBroadcast.test.ts
git commit -m "feat: export complete factual town reports"
```

## Task 3: Update the one-click UI and verify the real site

**Files:**
- Modify: `src/components/EventBroadcast.tsx`
- Modify: `src/index.css`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Write the failing UI assertion**

In `src/components/EventBroadcast.test.ts`, read `EventBroadcast.tsx` and assert it contains `导出完整日报` and `人物、关系、地点、活动与原始对话`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --runInBand src/components/EventBroadcast.test.ts`  
Expected: FAIL because the existing button says `导出日报`.

- [ ] **Step 3: Update the existing card without adding a new panel**

Change only the copy:

```tsx
<strong>灯塔镇完整观察日报</strong>
<small>人物、关系、地点、活动与原始对话</small>
<button onClick={exportDailyReport} aria-label="导出完整观察日报">
  ↓ 导出完整日报
</button>
```

Keep the existing Blob download. Rename the file to `灯塔镇完整观察日报-YYYY-MM-DD.md`. Update README with the button location, included sections, local storage source, and the statement that the report records facts rather than writing research conclusions.

- [ ] **Step 4: Run full verification**

```bash
npm test -- --runInBand
npm run validate:world
npm run build
./scripts/check-lighthouse-site.sh
git diff --check
```

Expected: all tests pass, assets validate, client bundle boundary validates, and output includes `frontend=200 backend=tcp-open`.

- [ ] **Step 5: Browser acceptance and commit**

At `http://localhost:5173/ai-town`, verify the new button is visible, click it, confirm no critical console errors, and inspect the generated Markdown through the tested generator. Then commit:

```bash
git add src/components/EventBroadcast.tsx src/components/EventBroadcast.test.ts src/index.css README.zh-CN.md
git commit -m "feat: add complete one-click town daily report"
```
