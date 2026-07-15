# Resident Life Dossiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dynamic, photo-rich life dossier to every Lighthouse Town resident without resetting the existing world or increasing LLM usage.

**Architecture:** Keep authored adult profiles and relationship semantics in a focused world-data module. A Convex query combines that data with live player activity and locally stored messages; a dedicated React component renders the result inside the existing resident panel. Generated photography is stored as normal public assets.

**Tech Stack:** TypeScript, React 18, Convex, Jest, CSS, built-in Image 2

---

### Task 1: Complete the ninth resident migration

**Files:**
- Modify: `convex/init.ts`
- Create: `data/spritesheets/f9.ts`
- Modify: `data/worlds/lighthouse-town/characters.ts`
- Modify: `data/worlds/lighthouse-town/spritesheets.ts`
- Modify: `data/characters.ts`
- Modify: `scripts/generate-lighthouse-assets.mjs`
- Test: `data/worlds/lighthouse-town/content.test.ts`

- [ ] Write expectations for nine unique residents and grounded fortune-teller language.
- [ ] Run `npm test -- --runInBand data/worlds/lighthouse-town/content.test.ts` and confirm the eight-person data fails.
- [ ] Add `f9`, 玄微先生, nine-frame validation, and name-based missing-resident synchronization.
- [ ] Run the focused test and `npm run validate:world`; expect both to pass.

### Task 2: Define life and relationship data

**Files:**
- Create: `data/worlds/lighthouse-town/lives.ts`
- Create: `data/worlds/lighthouse-town/lives.test.ts`

- [ ] Write a test requiring nine adult profiles, four photos each, complete life fields, and valid friendship/romance/business relation targets.
- [ ] Run `npm test -- --runInBand data/worlds/lighthouse-town/lives.test.ts`; expect a missing-module failure.
- [ ] Implement `residentLifeProfiles`, `ResidentRelation`, and `getLifeProfileByName` with all nine profiles and explicit reciprocal relations.
- [ ] Run the focused test; expect all profile invariants to pass.

### Task 3: Build the dynamic dossier query

**Files:**
- Create: `convex/lives.ts`
- Create: `convex/lives.test.ts`

- [ ] Write tests for `deriveLiveStats`: conversation raises social mood, activity changes the situation label, and values stay between 0 and 100.
- [ ] Run `npm test -- --runInBand convex/lives.test.ts`; expect a missing-module failure.
- [ ] Implement a pure `deriveLiveStats` plus `residentDossier` query that joins player name, active world state, recent messages, authored profile, and relation targets.
- [ ] Run the focused test; expect all derived-state cases to pass.

### Task 4: Render the dossier in resident details

**Files:**
- Create: `src/components/ResidentDossier.tsx`
- Create: `src/components/ResidentDossier.test.ts`
- Modify: `src/components/PlayerDetails.tsx`
- Modify: `src/index.css`

- [ ] Write source-level component tests requiring the photo gallery, AI-image disclosure, six status meters, life facts, relation badges, and recent timeline.
- [ ] Run `npm test -- --runInBand src/components/ResidentDossier.test.ts`; expect a missing-component failure.
- [ ] Implement the query-backed component and mount it before the original biography and conversation history.
- [ ] Add responsive CSS so the gallery and cards remain readable in the observer drawer.
- [ ] Run the focused test and `npm run build`; expect both to pass.

### Task 5: Generate and install resident photography

**Files:**
- Create: `public/assets/worlds/lighthouse-town/residents/<resident-id>/portrait.webp`
- Create: `public/assets/worlds/lighthouse-town/residents/<resident-id>/work.webp`
- Create: `public/assets/worlds/lighthouse-town/residents/<resident-id>/life.webp`
- Create: `public/assets/worlds/lighthouse-town/residents/<resident-id>/social.webp`
- Modify: `public/assets/worlds/lighthouse-town/asset-sources.md`

- [ ] Generate one identity-consistent four-panel photorealistic contact sheet per adult resident with the built-in Image 2 tool.
- [ ] Copy each sheet into the workspace, split it into four equal images, convert to WebP, and verify dimensions and file size.
- [ ] Record AI generation provenance, prompt family, date, and the non-celebrity/no-watermark constraints.
- [ ] Run a file manifest check requiring exactly 36 WebP photographs.

### Task 6: Migrate and verify the live site

**Files:**
- Modify: generated `convex/_generated/api.d.ts`
- Modify: `README.zh-CN.md`

- [ ] Run the full Jest suite, `npm run build`, and `npm run validate:world`; all must pass from fresh commands.
- [ ] Run `npx convex run init` and verify `queuedResidents` includes only `玄微先生` on the first call and is empty after synchronization.
- [ ] Rebuild and restart the persistent local site with `./scripts/install-lighthouse-site.sh`.
- [ ] Run `./scripts/check-lighthouse-site.sh` and browser-check the map, nine-resident badge, 玄微先生 dossier, four photos, relationships, recent activity, and working chat button.
- [ ] Commit implementation without deleting the original eight-person event or message records.
