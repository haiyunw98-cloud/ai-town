# Continuous Town Research Archive Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Make Lighthouse Town continue low-cost factual life while unobserved, validate the complete daily-event lifecycle, export research-grade IMA-ready archives without touching Obsidian, and upload the integrated branch.

**Architecture:** Add an idempotent slot-based background simulation beside the real-time engine. Reuse economy, relation, and life-event primitives through inactive-world-only entry points. Add a standalone archive loop that reads Convex snapshots and atomically writes a dedicated research directory. Verify events with an accelerated, isolated lifecycle rehearsal.

**Tech Stack:** Convex, TypeScript, React/Vite, Vitest/Jest, Node.js scripts, macOS `screen`, Git.

---

### Task 1: Persistent simulation state and deterministic rules

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/backgroundLifeRules.ts`
- Test: `convex/backgroundLifeRules.test.ts`

1. Write failing tests for slot keys, resident rotation, day-part actions, seven-day catch-up bounds, and deterministic idempotency keys.
2. Add the background simulation state table and indexes.
3. Implement pure deterministic rules with no network or model dependency.
4. Run the focused tests and commit.

### Task 2: Inactive-world economy and relationship advancement

**Files:**
- Modify: `convex/townEconomy.ts`
- Modify: `convex/townRelations.ts`
- Modify: `convex/lifeEvents.ts`
- Create: `convex/backgroundLife.ts`
- Test: `convex/backgroundLife.test.ts`

1. Write failing tests proving inactive worlds can settle one background action while manually paused worlds cannot.
2. Add narrow internal entry points that reuse existing settlement and daily-cap rules.
3. Implement idempotent slot processing and bounded continuation.
4. Verify no messages or model calls are produced.
5. Run focused tests and commit.

### Task 3: Cron, hard pause, and bounded wake catch-up

**Files:**
- Modify: `convex/crons.ts`
- Modify: `convex/world.ts`
- Modify: `src/hooks/useWorldHeartbeat.ts`
- Test: relevant world/background tests

1. Write failing tests for `running`, `inactive`, and `stoppedByDeveloper` transitions.
2. Schedule the five-minute background tick.
3. Advance the cursor without facts during manual pause.
4. Ensure an observer heartbeat can restart only inactive worlds, while manual pause remains paused.
5. Run focused tests and commit.

### Task 4: Accelerated daily-event runtime rehearsal

**Files:**
- Create: `scripts/verify-daily-event-runtime.mjs`
- Modify: `package.json`
- Test: event state-machine and persistence tests

1. Create a failing fixture assertion for the complete lifecycle.
2. Drive every event stage with a deterministic clock and isolated state.
3. Assert map checkpoints, safe elimination, one-time rewards, return, normal-life restoration, and archive-only legacy competition.
4. Add `npm run verify:event-runtime`, run it, and commit.

### Task 5: IMA-ready independent archive exporter

**Files:**
- Create: `scripts/export-lighthouse-ima.mjs`
- Create: `scripts/run-lighthouse-archive.mjs`
- Create: `scripts/export-lighthouse-ima.test.mjs`
- Modify: `package.json`
- Modify: `README.md`

1. Write tests for Shanghai day selection, Markdown/JSON rendering, atomic paths, and secret/Obsidian exclusion.
2. Query the default world and observer snapshot through the local Convex CLI.
3. Write factual ledger, social-observation material, raw JSON, and manifest to the dedicated IMA directory.
4. Add one-shot and loop commands, run against the live local database, and commit.

### Task 6: Site-service integration

**Files:**
- Modify: `scripts/install-lighthouse-site.sh`
- Modify: `scripts/start-lighthouse-site.sh`
- Modify: `scripts/stop-lighthouse-site.sh`
- Modify: `scripts/check-lighthouse-site.sh`
- Test: shell syntax and live service checks

1. Add a separate archive `screen` session and heartbeat/PID state.
2. Keep ports fixed at backend `3210` and frontend `4174`; the archive uses no port.
3. Verify restart safety, health reporting, and that stopping the site leaves no orphan process.
4. Commit.

### Task 7: Integration and complete verification

**Files:** all affected files

1. Merge `codex/lighthouse-town` into the feature branch without rewriting history.
2. Resolve conflicts while preserving both the continuous-life work and current UI/site behavior.
3. Run typecheck, full test suite, build, event rehearsal, one-shot archive export, shell validation, live site check, and browser acceptance.
4. Inspect the worktree for secrets, generated archives, `.convex`, and unrelated files; do not commit them.
5. Commit merge/fixes.

### Task 8: Upload Git branch

1. Inspect remote and authentication.
2. Push `codex/daily-town-implementation` without force.
3. Create a merge request when the remote provider and credentials permit.
4. Report the pushed branch, URL, verification evidence, and any external limitation.
