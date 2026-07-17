# Grounded Social Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the social observation report into evidence-grounded analysis with traceable findings, confidence, alternatives, limitations and a deterministic rules fallback.

**Architecture:** A pure evidence builder converts the single daily snapshot into stable facts and metrics. Local Gemma receives only the bounded evidence JSON and returns validated structured findings; invalid or unavailable output falls back to rule findings. The report renderer presents analysis separately from the factual ledger and exposes generation stages without pausing the town.

**Tech Stack:** TypeScript, Convex action, local Ollama `gemma4:12b`, React, Jest, Markdown export.

---

## File structure

- Create `src/components/socialEvidence.ts` and `.test.ts`: stable evidence IDs, metrics and rule findings.
- Modify `convex/socialObservations.ts` and `.test.ts`: structured local-only protocol, validation and safe fallbacks.
- Modify `src/components/socialObservationReport.ts` and `.test.ts`: evidence digest, analysis sections, method disclosure and legacy-condition filtering.
- Modify `src/components/reportExportController.ts` and tests: three visible generation stages and source/fallback reason.
- Modify `src/components/EventBroadcast.tsx`, tests and `src/index.css`: stage status and report source display.
- Modify `README.md`: research boundary and local/cloud data path.

### Task 1: Build stable daily evidence and deterministic findings

**Files:**
- Create: `src/components/socialEvidence.ts`
- Create: `src/components/socialEvidence.test.ts`

- [ ] **Step 1: Write failing evidence tests**

```ts
import { buildSocialEvidence } from './socialEvidence';

test('creates stable network, activity, institution and observer evidence', () => {
  const result = buildSocialEvidence(fixtureDailyReportData());
  expect(result.evidence.map((entry) => entry.evidenceId)).toEqual([
    'E001', 'E002', 'E003', 'E004', 'E005', 'E006',
  ]);
  expect(result.evidence.map((entry) => entry.category)).toEqual(expect.arrayContaining([
    'interaction-network', 'activity-distribution', 'institution-use', 'observer-intervention',
  ]));
  expect(result.ruleFindings).toHaveLength(3);
  expect(result.ruleFindings.every((finding) => finding.evidenceIds.length > 0)).toBe(true);
  expect(result.ruleFindings.every((finding) => finding.alternativeExplanation.length > 0)).toBe(true);
});

test('does not treat legacy scripted mystery content as a current social pattern', () => {
  const result = buildSocialEvidence(fixtureDailyReportData({
    messages: ['小镇异变，灯火装置与河道线索交汇。'],
  }));
  expect(JSON.stringify(result)).not.toMatch(/小镇异变|灯火装置|河道线索|花木线索/u);
  expect(result.methodNotes).toContain('已排除旧实验条件诱发的谜团内容');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand src/components/socialEvidence.test.ts`

Expected: FAIL because the evidence module is absent.

- [ ] **Step 3: Implement evidence types and builder**

```ts
export type EvidenceCategory =
  | 'interaction-network' | 'relationship-signal' | 'labor-commerce'
  | 'institution-use' | 'public-life' | 'observer-intervention' | 'data-coverage';
export type Confidence = '高' | '中' | '低';
export type ObservationEvidence = {
  evidenceId: string;
  category: EvidenceCategory;
  statement: string;
  sourceKeys: string[];
  confidence: Confidence;
  limitations: string[];
};
export type AnalysisFinding = {
  claim: string;
  evidenceIds: string[];
  confidence: Confidence;
  alternativeExplanation: string;
};
export type SocialEvidenceBundle = {
  evidence: ObservationEvidence[];
  ruleFindings: AnalysisFinding[];
  limitations: string[];
  followUps: string[];
  methodNotes: string[];
};
```

Use monotonically assigned `E001` IDs after sorting source events by timestamp and source key. Compute: unique resident pairs, interaction concentration, residents without recorded interaction, activity-category counts, institution visit counts, explicit cooperation/care/trade/dispute counts, observer message count and public-event versus ordinary-life count. Build exactly three rule findings from the best-covered metrics, each with at least one alternative explanation. Exclude legacy mystery messages with the shared conversation-policy matcher but retain a method note.

- [ ] **Step 4: Run evidence tests and verify GREEN**

Run: `npm test -- --runInBand src/components/socialEvidence.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit evidence builder**

```bash
git add src/components/socialEvidence.ts src/components/socialEvidence.test.ts
git commit -m "feat: derive auditable town social evidence"
```

### Task 2: Replace free-form Gemma prose with validated structured analysis

**Files:**
- Modify: `convex/socialObservations.ts`
- Modify: `convex/socialObservations.test.ts`

- [ ] **Step 1: Replace old narrative tests with failing structured tests**

```ts
test('accepts valid structured findings that cite only supplied evidence', async () => {
  const result = await requestSocialObservation(bundle, {
    getConfig: () => ollamaConfig,
    complete: async () => ({ content: JSON.stringify({
      findings: [{
        claim: '当日互动集中在两组居民之间。', evidenceIds: ['E001'],
        confidence: '中', alternativeExplanation: '其余居民可能在未覆盖时段互动。',
      }],
      limitations: ['仅覆盖当日可见记录。'],
      followUps: ['继续记录未出现互动的居民。'],
    }) }),
  });
  expect(result.source).toBe('model');
  expect(result.findings[0].evidenceIds).toEqual(['E001']);
});

test.each(['unknown evidence', 'missing alternative', 'invalid confidence'])(
  'falls back to rule findings for %s', async () => {
    const result = await requestSocialObservation(bundle, invalidCompletionFixture());
    expect(result).toMatchObject({ source: 'fallback', fallbackReason: '输出无效' });
    expect(result.findings).toEqual(bundle.ruleFindings);
  },
);

test('never calls a non-Ollama provider and uses fixed gemma4:12b', async () => {
  const complete = jest.fn();
  const result = await requestSocialObservation(bundle, {
    getConfig: () => ({ ...ollamaConfig, provider: 'openai' }), complete,
  });
  expect(complete).not.toHaveBeenCalled();
  expect(result.fallbackReason).toBe('配置非本地');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand convex/socialObservations.test.ts`

Expected: FAIL because the action still accepts a digest and returns free-form narrative.

- [ ] **Step 3: Implement the structured protocol and validator**

Use this result contract:

```ts
export type SocialObservation = {
  source: 'model' | 'fallback';
  fallbackReason?: '模型不可用' | '输出无效' | '配置非本地';
  findings: AnalysisFinding[];
  limitations: string[];
  followUps: string[];
};
```

Change the action argument to a bounded JSON string named `evidenceJson`, parse it as `SocialEvidenceBundle`, and pass only `evidence` plus rule boundaries to Gemma. Require JSON with 3–5 findings, 2–4 limitations and 2–4 follow-ups. Validate every evidence ID against the supplied set, confidence against `高/中/低`, non-empty alternatives, known entity names and forbidden causal/diagnostic terms. Clamp total output to 1,000 Chinese characters before parsing. Return `bundle.ruleFindings` on every failure. Keep `model: 'gemma4:12b'`, `temperature: 0.2`, `stream: false` and local-provider enforcement.

- [ ] **Step 4: Run structured action tests**

Run: `npm test -- --runInBand convex/socialObservations.test.ts`

Expected: PASS including untrusted JSON escaping and no sensitive logging.

- [ ] **Step 5: Commit the model boundary**

```bash
git add convex/socialObservations.ts convex/socialObservations.test.ts
git commit -m "feat: validate evidence-grounded Gemma analysis"
```

### Task 3: Render findings, evidence, alternatives and method limits

**Files:**
- Modify: `src/components/socialObservationReport.ts`
- Modify: `src/components/socialObservationReport.test.ts`

- [ ] **Step 1: Add failing report assertions**

```ts
test('renders findings as analysis rather than a rewritten ledger', () => {
  const report = buildSocialObservationReport(fixture, modelObservation);
  expect(report).toContain('## 本地模型辅助的谨慎观察');
  expect(report).toContain('证据：E001');
  expect(report).toContain('置信度：中');
  expect(report).toContain('其他可能解释：');
  expect(report).toContain('## 方法与边界说明');
  expect(report).toContain('本地 Gemma 辅助分析');
});

test('renders useful rule analysis when Gemma does not complete', () => {
  const report = buildSocialObservationReport(fixture, fallbackObservation);
  expect(report).toContain('规则分析（本地模型未完成）');
  expect(report.match(/证据：E\d{3}/gu)?.length).toBeGreaterThanOrEqual(3);
  expect(report).not.toContain('小镇异变');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand src/components/socialObservationReport.test.ts`

Expected: FAIL because the report expects one narrative string.

- [ ] **Step 3: Integrate the evidence bundle and structured findings**

Build one `SocialEvidenceBundle` from the same immutable daily snapshot used by the fact report. Serialize it for the action, then render every finding as:

```ts
lines.push(`### 发现 ${index + 1}`);
lines.push(`- 分析：${escapeMarkdown(finding.claim)}`);
lines.push(`- 证据：${finding.evidenceIds.join('、')}`);
lines.push(`- 置信度：${finding.confidence}`);
lines.push(`- 其他可能解释：${escapeMarkdown(finding.alternativeExplanation)}`);
```

Keep all ten existing chapters. Place evidence definitions in an appendix so every ID is traceable. Method notes must disclose coverage, source, fallback reason and the legacy-experiment filter. Do not copy analysis into the factual ledger.

- [ ] **Step 4: Run report tests and verify GREEN**

Run: `npm test -- --runInBand src/components/socialObservationReport.test.ts`

Expected: PASS for model, fallback, empty-day and hostile-text fixtures.

- [ ] **Step 5: Commit report rendering**

```bash
git add src/components/socialObservationReport.ts src/components/socialObservationReport.test.ts src/components/socialEvidence.ts
git commit -m "feat: render evidence-backed social observation logs"
```

### Task 4: Expose generation stages and safe fallback source in the observer UI

**Files:**
- Modify: `src/components/reportExportController.ts`
- Modify: `src/components/reportExportController.test.ts`
- Modify: `src/components/EventBroadcast.tsx`
- Modify: `src/components/EventBroadcast.test.ts`
- Modify: `src/index.css`

- [ ] **Step 1: Add failing stage tests**

```ts
test('publishes all three stages for social observation generation', async () => {
  const stages: string[] = [];
  await generateSocialReport({ ...deps, onStage: (stage) => stages.push(stage) });
  expect(stages).toEqual([
    '正在统计当日事实',
    '正在等待本地 Gemma（可能需要约一分钟）',
    '正在整理分析结果',
  ]);
});

test('keeps the town running and displays fallback source', () => {
  const source = readFileSync('src/components/EventBroadcast.tsx', 'utf8');
  expect(source).not.toContain('pauseWorld');
  expect(source).toContain('fallbackReason');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runInBand src/components/reportExportController.test.ts src/components/EventBroadcast.test.ts`

Expected: FAIL because stage callbacks and fallback source are not exposed.

- [ ] **Step 3: Implement staged UI state**

Add `ReportGenerationStage` with the three exact labels, update the persistent report task store before evidence build, before the Convex action and before Markdown rendering, and show the label below the social-report button. When complete, show `本地 Gemma 辅助分析` or `规则分析（本地模型未完成：<reason>）`. Do not pause the world, unload Ollama or issue a second model request.

- [ ] **Step 4: Run controller/UI tests and build**

Run: `npm test -- --runInBand src/components/reportExportController.test.ts src/components/EventBroadcast.test.ts && npm run build`

Expected: PASS and successful client-boundary validation.

- [ ] **Step 5: Commit staged UI**

```bash
git add src/components/reportExportController.ts src/components/reportExportController.test.ts src/components/EventBroadcast.tsx src/components/EventBroadcast.test.ts src/index.css
git commit -m "feat: show social report analysis progress and source"
```

### Task 5: Full privacy, fallback and live-model verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run all analysis tests**

Run: `npm test -- --runInBand src/components/socialEvidence.test.ts convex/socialObservations.test.ts src/components/socialObservationReport.test.ts src/components/reportExportController.test.ts src/components/EventBroadcast.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full repository verification**

Run: `npm test -- --runInBand && npm run build && npm run validate:world`

Expected: all tests and build checks pass.

- [ ] **Step 3: Verify one local Gemma action request**

Run: `npx convex run socialObservations:generate '{"evidenceJson":"{\"evidence\":[{\"evidenceId\":\"E001\",\"category\":\"data-coverage\",\"statement\":\"当日记录覆盖九位居民。\",\"sourceKeys\":[\"coverage\"],\"confidence\":\"高\",\"limitations\":[]}],\"ruleFindings\":[{\"claim\":\"当前只能确认覆盖范围。\",\"evidenceIds\":[\"E001\"],\"confidence\":\"高\",\"alternativeExplanation\":\"覆盖不等于每人都有活动。\"}],\"limitations\":[\"样本较少\"],\"followUps\":[\"继续记录\"],\"methodNotes\":[]}"}'`

Expected: returns either validated `source: model` findings or a non-empty `source: fallback` rules result, never an empty narrative.

- [ ] **Step 4: Document research and deployment boundaries**

Update README with evidence IDs, source labels, rule fallback, one-minute local queue expectation, no paid fallback, and the distinction between local self-hosted Convex and cloud deployment data paths.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain evidence-grounded town observation"
```
