# Lighthouse Town Beautification and Challenge Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beautify Lighthouse Town, activate eight autonomous residents, and run a locally powered, observable Million Golden Shells challenge from announcement through awards.

**Architecture:** Keep exact map collision and animation assets deterministic in the existing SVG/tile pipeline, while using Image 2 for the visual concept and event poster. Add a small event domain with a pure deterministic state machine, Convex persistence/coordinator functions, bounded Gemma decision calls, and a read-only React broadcast panel.

**Tech Stack:** TypeScript 5, React 18, PixiJS 7, Convex 1.41, Jest/ts-jest, Tailwind CSS, Ollama `gemma4:12b`, built-in Image 2.

---

## File map

- `scripts/generate-lighthouse-assets.mjs`: reproducible SVG tiles and eight resident sprite slots.
- `data/worlds/lighthouse-town/map.ts`: walkable map, landmarks, event checkpoints, eight spawns.
- `data/worlds/lighthouse-town/characters.ts`: eight bilingual resident identities and relationships.
- `convex/events/types.ts`: event phase, participant and log domain types.
- `convex/events/stateMachine.ts`: pure seeded round advancement and fallback decisions.
- `convex/events/stateMachine.test.ts`: deterministic event rules and idempotency tests.
- `convex/events/model.ts`: bounded Gemma prompt for public declarations and finite choices.
- `convex/events.ts`: Convex queries, event creation, advancement and observer snapshot.
- `convex/schema.ts`: event persistence tables and indexes.
- `convex/crons.ts`: low-frequency event coordinator schedule.
- `src/components/EventBroadcast.tsx`: observer scoreboard, chronicle and announcement overlay.
- `src/components/EventBroadcast.test.ts`: pure display-model tests without a browser DOM dependency.
- `src/components/Game.tsx`: broadcast/detail tabs and map/sidebar layout.
- `src/i18n/catalogs.ts`: Chinese and English event labels.
- `public/assets/worlds/lighthouse-town/event-poster-v1.png`: Image 2 event illustration without embedded text.
- `public/assets/worlds/lighthouse-town/asset-sources.md`: prompts, authorship and asset provenance.

### Task 1: Stabilize and commit the local Gemma baseline

**Files:**
- Create: `convex/util/embeddingDimension.ts`
- Test: `convex/util/embeddingDimension.test.ts`
- Modify: `convex/agent/schema.ts`
- Modify: `convex/util/llmConfig.ts`
- Modify: `convex/util/llmConfig.test.ts`
- Modify: `convex/util/llm.ts`

- [ ] **Step 1: Run the focused baseline tests**

Run:

```bash
npm test -- --runInBand convex/util/embeddingDimension.test.ts convex/util/llmConfig.test.ts
```

Expected: both suites pass; Ollama resolves `reasoningEffort: 'none'` and the static vector dimension is `1024`.

- [ ] **Step 2: Push the schema once against the local deployment**

Run:

```bash
npx convex dev --once
```

Expected: schema evaluation succeeds without reading environment variables and the memory vector index is 1024-dimensional.

- [ ] **Step 3: Commit only the baseline runtime fix**

```bash
git add convex/_generated/api.d.ts convex/agent/schema.ts convex/util/embeddingDimension.ts convex/util/embeddingDimension.test.ts convex/util/llm.ts convex/util/llmConfig.ts convex/util/llmConfig.test.ts
git commit -m "fix: stabilize local Ollama runtime"
```

### Task 2: Generate and preserve the Image 2 visual direction

**Files:**
- Create: `docs/visuals/lighthouse-town-concept-v1.png`
- Create: `public/assets/worlds/lighthouse-town/event-poster-v1.png`
- Modify: `public/assets/worlds/lighthouse-town/asset-sources.md`

- [ ] **Step 1: Generate the concept image with built-in Image 2**

Use this prompt verbatim apart from tool-required wrapping:

```text
Use case: stylized-concept
Asset type: visual direction board for a top-down 2D game town
Primary request: a beautiful dusk-time Jiangnan water town centered on a mysterious inland lighthouse
Scene/backdrop: canals, arched stone bridges, white plaster houses with dark teal tiled roofs, tea house, academy, workshop, herb shop, lantern shop, fish market, lotus pond, boats and winding stone lanes
Style/medium: polished pixel-art-inspired game concept illustration, readable shapes and layered environmental detail
Composition/framing: elevated three-quarter overview showing a connected walkable town and central lighthouse plaza
Lighting/mood: warm lantern light against cool teal dusk, welcoming, lively and slightly mysterious
Color palette: dark teal, rice white, cinnabar, warm gold, jade water, lotus pink
Constraints: no logos, no watermark, no readable text, no copyrighted characters
```

Expected: the output contains the central lighthouse, canals, multiple active districts and a clear warm/cool palette.

- [ ] **Step 2: Generate the event poster with built-in Image 2**

```text
Use case: illustration-story
Asset type: wide in-game event announcement banner
Primary request: eight distinct adult townspeople racing through a lantern-lit Jiangnan water town toward a glowing inland lighthouse, collecting golden shell tokens
Style/medium: polished pixel-art-inspired adventure game key art with crisp silhouettes
Composition/framing: cinematic 3:2 landscape, lighthouse centered in the distance, eight participants visible across foreground and middle ground, safe negative space along the top for HTML title overlay
Lighting/mood: celebratory, high-energy, playful competition at dusk
Color palette: dark teal, rice white, cinnabar, warm gold, jade water
Constraints: exactly eight participants, no logos, no watermark, no readable text, no real people, no copyrighted characters
```

Expected: exactly eight visible participants and no embedded title text.

- [ ] **Step 3: Copy selected outputs into the repository and document provenance**

Append:

```markdown
## Image 2 references

- `docs/visuals/lighthouse-town-concept-v1.png`: built-in Image 2 visual-direction reference; prompt recorded in the implementation plan.
- `event-poster-v1.png`: built-in Image 2 event illustration; title and rules are rendered as HTML, not embedded in the image.
- Runtime tiles and sprites remain reproducible SVG generated by `scripts/generate-lighthouse-assets.mjs` using the concept palette and lighting hierarchy.
```

Run `git diff --check`, then commit:

```bash
git add docs/visuals/lighthouse-town-concept-v1.png public/assets/worlds/lighthouse-town/event-poster-v1.png public/assets/worlds/lighthouse-town/asset-sources.md
git commit -m "art: add Lighthouse Town event direction"
```

### Task 3: Expand the town to eight residents

**Files:**
- Modify: `data/worlds/lighthouse-town/content.test.ts`
- Modify: `data/worlds/lighthouse-town/characters.ts`

- [ ] **Step 1: Write the failing eight-resident assertions**

Change the count test to:

```ts
test('defines eight unique bilingual residents', () => {
  expect(lighthouseCharacters).toHaveLength(8);
  expect(new Set(lighthouseCharacters.map((character) => character.id)).size).toBe(8);
  expect(new Set(lighthouseCharacters.map((character) => character.sprite)).size).toBe(8);
  expect(lighthouseCharacters.map((character) => character.name['zh-CN'])).toEqual(
    expect.arrayContaining(['林澜', '沈砚', '唐果', '墨七', '苏萤', '白露', '顾潮', '阿满']),
  );
});
```

- [ ] **Step 2: Run the content test and verify red**

```bash
npm test -- --runInBand data/worlds/lighthouse-town/content.test.ts
```

Expected: FAIL because there are five residents and the sprite type omits `f2`, `f5`, and `f8`.

- [ ] **Step 3: Add the three complete bilingual identities**

Expand `LighthouseCharacter['sprite']` to all `f1`–`f8` values. Add `bai-lu` on `f2`, `gu-chao` on `f5`, and `a-man` on `f8`; each object must populate `name`, `publicDescription`, `identity`, `plan`, `speakingStyle`, `relationshipHook`, and `clue` in both locales. Every Chinese identity must say `灯塔镇` and every English identity must say `Lighthouse Town`.

- [ ] **Step 4: Run content and asset tests**

```bash
npm test -- --runInBand data/worlds/lighthouse-town/content.test.ts
npm run validate:world
```

Expected: PASS and all eight sprite names resolve.

- [ ] **Step 5: Commit the resident expansion**

```bash
git add data/worlds/lighthouse-town/characters.ts data/worlds/lighthouse-town/content.test.ts
git commit -m "feat: expand Lighthouse Town to eight residents"
```

### Task 4: Beautify the deterministic map and sprites

**Files:**
- Modify: `scripts/generate-lighthouse-assets.mjs`
- Modify: `public/assets/worlds/lighthouse-town/tileset.svg`
- Modify: `public/assets/worlds/lighthouse-town/residents.svg`
- Modify: `data/worlds/lighthouse-town/map.ts`
- Modify: `scripts/validate-world-assets.mjs`

- [ ] **Step 1: Add failing landmark and spawn validation**

Require eight unique walkable spawn points and named checkpoints:

```js
const requiredCheckpoints = ['plaza', 'teahouse', 'academy', 'lotusPond', 'dock', 'workshop', 'herbShop', 'lanternShop'];
if (map.spawnPoints.length !== 8) failures.push('map must expose eight resident spawn points');
for (const name of requiredCheckpoints) {
  if (!map.eventCheckpoints?.[name]) failures.push(`missing event checkpoint: ${name}`);
}
```

- [ ] **Step 2: Run validation and verify red**

```bash
npm run validate:world
```

Expected: FAIL because only six spawns exist and `eventCheckpoints` is absent.

- [ ] **Step 3: Enrich the generator and map**

Keep the 256×128 tileset and 384×256 resident sheet contracts. Add layered water highlights, roof ridge caps, eave shadows, window glow, stone edge variation, multi-tone trees, flower clusters, market awnings, hanging lanterns and character-specific accessories. Update the map to place the herb shop, lantern shop, fish stalls, boats, gardens and announcement platform without blocking roads. Export:

```ts
export const eventCheckpoints = {
  plaza: { x: 22, y: 15 },
  teahouse: { x: 5, y: 20 },
  academy: { x: 5, y: 7 },
  lotusPond: { x: 26, y: 8 },
  dock: { x: 24, y: 6 },
  workshop: { x: 35, y: 20 },
  herbShop: { x: 15, y: 7 },
  lanternShop: { x: 35, y: 7 },
} as const;
```

- [ ] **Step 4: Regenerate and validate assets**

```bash
node scripts/generate-lighthouse-assets.mjs
npm run validate:world
npm test -- --runInBand data/worlds/lighthouse-town/content.test.ts
```

Expected: generator completes, asset dimensions remain exact, and every spawn/checkpoint is walkable.

- [ ] **Step 5: Commit the visual map update**

```bash
git add scripts/generate-lighthouse-assets.mjs scripts/validate-world-assets.mjs data/worlds/lighthouse-town/map.ts public/assets/worlds/lighthouse-town/tileset.svg public/assets/worlds/lighthouse-town/residents.svg
git commit -m "art: enrich Lighthouse Town map and residents"
```

### Task 5: Implement the pure event state machine

**Files:**
- Create: `convex/events/types.ts`
- Create: `convex/events/stateMachine.ts`
- Create: `convex/events/stateMachine.test.ts`

- [ ] **Step 1: Write failing state-machine tests**

Define fixtures for eight participants and assert:

```ts
expect(createInitialEvent('world-1', eightResidents, 42).phase).toBe('announcement');
expect(advanceEvent(event, event.phaseEndsAt).phase).toBe('treasureHunt');
expect(advanceEvent(treasureResult, treasureResult.phaseEndsAt).activeCount).toBe(6);
expect(advanceEvent(relayResult, relayResult.phaseEndsAt).activeCount).toBe(4);
expect(advanceEvent(tradeResult, tradeResult.phaseEndsAt).activeCount).toBe(2);
expect(advanceEvent(finalResult, finalResult.phaseEndsAt).winnerId).toBeTruthy();
expect(advanceEvent(completed, completed.phaseEndsAt)).toEqual(completed);
```

- [ ] **Step 2: Run the test and verify red**

```bash
npm test -- --runInBand convex/events/stateMachine.test.ts
```

Expected: FAIL because event modules do not exist.

- [ ] **Step 3: Implement deterministic domain types and advancement**

Use these phase and status contracts:

```ts
export type EventPhase = 'announcement' | 'treasureHunt' | 'lanternRelay' | 'secretTrade' | 'lighthouseFinal' | 'awards';
export type ParticipantRole = 'competitor' | 'commentator' | 'helper' | 'interferer' | 'winner';
export type EventParticipant = { residentId: string; score: number; shells: number; active: boolean; role: ParticipantRole; rank?: number };
export type TownEventState = { seed: number; phase: EventPhase; phaseEndsAt: number; participants: EventParticipant[]; winnerId?: string; log: EventLogEntry[] };
```

Implement a small seeded PRNG, stable score sorting with resident ID tie-breaks, `8→6→4→2→1` advancement, eliminated-role rotation, unique log keys, and an awards no-op.

- [ ] **Step 4: Run tests and commit**

```bash
npm test -- --runInBand convex/events/stateMachine.test.ts
git add convex/events/types.ts convex/events/stateMachine.ts convex/events/stateMachine.test.ts
git commit -m "feat: add deterministic town event rules"
```

### Task 6: Persist, schedule and query the event

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/crons.ts`
- Modify: `convex/init.ts`
- Modify: `convex/aiTown/agentInputs.ts`
- Create: `convex/events.ts`
- Create: `convex/events/model.ts`
- Test: `convex/events/model.test.ts`

- [ ] **Step 1: Write failing model-boundary tests**

Assert that the event prompt contains the resident identity, current phase, finite choices, a 60-Chinese-character public-output cap, and local-only provider enforcement. Assert the fallback chooses one supplied option and returns a short in-character public quote.

- [ ] **Step 2: Run the focused test and verify red**

```bash
npm test -- --runInBand convex/events/model.test.ts
```

Expected: FAIL because the event model module is absent.

- [ ] **Step 3: Add event tables**

Add:

```ts
townEvents: defineTable({
  worldId: v.id('worlds'), status: v.union(v.literal('scheduled'), v.literal('announced'), v.literal('running'), v.literal('completed')),
  phase: v.string(), seed: v.number(), phaseEndsAt: v.number(), winnerId: v.optional(v.string()), updatedAt: v.number(),
}).index('worldId', ['worldId']).index('status', ['status']),
eventParticipants: defineTable({
  eventId: v.id('townEvents'), residentId: v.string(), displayName: v.string(), score: v.number(), shells: v.number(), active: v.boolean(), role: v.string(), rank: v.optional(v.number()), quote: v.optional(v.string()),
}).index('eventId', ['eventId']),
eventLog: defineTable({
  eventId: v.id('townEvents'), eventKey: v.string(), sequence: v.number(), kind: v.string(), text: v.string(), createdAt: v.number(),
}).index('eventId', ['eventId']).index('eventKey', ['eventId', 'eventKey']),
```

- [ ] **Step 4: Implement coordinator and snapshot query**

Export `ensureFirstEvent`, `advanceActiveEvents`, and `observerSnapshot`. Only create an event when exactly eight agents and eight player descriptions exist; map each agent to its player through the serialized `world.agents` array. Patch tables from the pure state-machine result and check `eventKey` before inserting every log row. When no event exists, `observerSnapshot` returns recent persisted messages as ordinary town-chronicle entries.

Add an engine input that gives an AI resident a deterministic event destination without interfering with its normal LLM operation:

```ts
eventMove: inputHandler({
  args: { playerId, destination: point, description: v.string(), until: v.number() },
  handler: (game, now, args) => {
    const player = game.world.players.get(parseGameId('players', args.playerId));
    if (!player) return null;
    movePlayer(game, now, player, args.destination);
    player.activity = { description: args.description, until: args.until };
    return null;
  },
}),
```

At each phase transition, submit one `eventMove` input per active participant toward a named `eventCheckpoints` location; eliminated participants move to the plaza as commentators/helpers. Schedule creation/advancement every 30 seconds and also schedule `ensureFirstEvent` after `init` creates the agents:

```ts
crons.interval('advance town challenge', { seconds: 30 }, internal.events.advanceActiveEvents);
```

- [ ] **Step 5: Implement bounded local model decisions**

`convex/events/model.ts` must call the existing `chatCompletion` only when `resolveLLMConfig().provider === 'ollama'`, request one finite `choiceId` plus `publicQuote`, cap `max_tokens` at 96, and fall back deterministically on timeout, malformed JSON or any non-local provider.

- [ ] **Step 6: Push schema, run tests and commit**

```bash
npx convex dev --once
npm test -- --runInBand convex/events/stateMachine.test.ts convex/events/model.test.ts
git add convex/schema.ts convex/crons.ts convex/init.ts convex/aiTown/agentInputs.ts convex/events.ts convex/events/model.ts convex/events/model.test.ts convex/_generated/api.d.ts
git commit -m "feat: persist and coordinate town challenge"
```

### Task 7: Build the observer broadcast and town chronicle

**Files:**
- Create: `src/components/EventBroadcast.tsx`
- Create: `src/components/EventBroadcast.test.ts`
- Modify: `src/components/Game.tsx`
- Modify: `src/index.css`
- Modify: `src/i18n/catalogs.ts`
- Modify: `src/i18n/index.test.ts`

- [ ] **Step 1: Write failing display-model and translation tests**

Test a pure `buildBroadcastView(snapshot, locale)` helper for no-event, running and completed states. Add equal zh-CN/en keys for `event.title`, `event.prize`, `event.phase.*`, `event.rank`, `event.chronicle`, `event.countdown`, `event.winner`, `event.noActivity`, and `event.openBroadcast`.

- [ ] **Step 2: Run tests and verify red**

```bash
npm test -- --runInBand src/components/EventBroadcast.test.ts src/i18n/index.test.ts
```

Expected: FAIL because the component/helper and event keys are missing.

- [ ] **Step 3: Implement the broadcast UI**

Query `api.events.observerSnapshot`. Render the Image 2 poster and HTML title during announcement; otherwise render phase badge, countdown, prize, eight-row scoreboard and the newest 30 log entries. Use a tab switch between `赛事直播` and the existing resident detail column. On mobile, render the broadcast as a collapsible bottom section.

- [ ] **Step 4: Apply the polished frame styling**

Add `.event-broadcast`, `.event-poster`, `.event-score-row`, `.event-log-entry`, `.lantern-glow`, and reduced-motion rules using the existing teal/rice/cinnabar/gold variables. Keep text contrast at or above the existing sidebar and do not obscure map interaction.

- [ ] **Step 5: Run tests and build**

```bash
npm test -- --runInBand src/components/EventBroadcast.test.ts src/i18n/index.test.ts
npm run build
```

Expected: tests pass and Vite builds without TypeScript errors.

- [ ] **Step 6: Commit the observer experience**

```bash
git add src/components/EventBroadcast.tsx src/components/EventBroadcast.test.ts src/components/Game.tsx src/index.css src/i18n/catalogs.ts src/i18n/index.test.ts
git commit -m "feat: add town challenge broadcast"
```

### Task 8: Back up, migrate and launch the eight-person event

**Files:**
- Modify: `.gitignore`
- Runtime output: `backups/lighthouse-town-before-eight-residents.zip`

- [ ] **Step 1: Ignore local backups and export current records**

Add `backups/` to `.gitignore`, then run:

```bash
mkdir -p backups
npx convex export --path backups/lighthouse-town-before-eight-residents.zip
```

Expected: the zip exists and contains the current local Convex tables.

- [ ] **Step 2: Rebuild the local world with eight residents**

```bash
npx convex run testing:wipeAllTables
npx convex run init
```

Expected: `world:gameDescriptions` returns eight agent descriptions using all eight sprite slots.

- [ ] **Step 3: Create and announce the first event**

```bash
npx convex run events:ensureFirstEvent
npx convex run events:observerSnapshot
```

Expected: the event status is `announced`, eight participants exist, and the first log entry announces the Million Golden Shells challenge.

- [ ] **Step 4: Run full verification**

```bash
npm run validate:world
npm test -- --runInBand
npm run build
npx convex run events:observerSnapshot
curl -I http://localhost:5173/ai-town
```

Expected: world validation, all tests and build pass; snapshot shows an advancing event; the observer site returns HTTP 200.

- [ ] **Step 5: Commit migration documentation and final fixes**

```bash
git add .gitignore README.zh-CN.md
git commit -m "docs: document local event launch and backups"
```

Do not add the backup zip to Git. Leave the local backend and frontend running at `http://localhost:5173/ai-town` for observation.
