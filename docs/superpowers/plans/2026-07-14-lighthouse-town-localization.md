# Lighthouse Town Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn upstream AI Town into a bilingual Chinese-localized 「灯塔镇」 with an original Jiangnan fantasy world and environment-configured LLM providers.

**Architecture:** Keep the Convex simulation and PixiJS renderer intact. Add typed browser i18n, isolate localized setting/characters/assets behind a Lighthouse Town world module, and make server language and model configuration explicit environment-driven concerns.

**Tech Stack:** React 18, TypeScript, Vite, PixiJS, Convex, Jest, Tailwind CSS, Docker Compose.

---

## File map

- `src/i18n/*`: typed catalogs, interpolation, persistence, React context, and tests.
- `src/components/LanguageButton.tsx`: per-browser language toggle.
- `data/worlds/lighthouse-town/*`: manifest, five bilingual residents, map, sprites, and tests.
- `convex/util/worldLocale.ts`: deployment-level agent language selection.
- `convex/util/llmConfig.ts`: pure environment parsing and validation.
- `public/assets/worlds/lighthouse-town/*`: original map and resident art.
- `scripts/validate-world-assets.mjs`: deterministic map/image/documentation validation.
- `.env.example`, `README.zh-CN.md`, `README.md`: bilingual operations documentation.

### Task 1: Import upstream history and preserve approved documents

**Files:** Preserve both files under `docs/superpowers/`.

- [x] **Step 1: Commit this plan**

```bash
git add docs/superpowers/plans/2026-07-14-lighthouse-town-localization.md
git commit -m "docs: plan Lighthouse Town localization"
```

- [x] **Step 2: Fetch upstream and transplant the documentation commits**

```bash
git remote add origin https://github.com/a16z-infra/ai-town.git
git fetch origin main
git branch codex/design-docs main
git switch -C codex/lighthouse-town origin/main
git cherry-pick codex/design-docs~1 codex/design-docs
```

Expected: upstream files and both documents coexist without an unrelated-history merge.

- [x] **Step 3: Ignore `.superpowers/`, install, and establish baseline**

Append `.superpowers/` to `.gitignore`, then run:

```bash
npm install
npm test -- --runInBand
npm run build
```

Record any upstream-only failure before feature edits. Commit `.gitignore` and `package-lock.json` as `chore: initialize Lighthouse Town fork`.

### Task 2: Add typed bilingual UI infrastructure

**Files:** Create `src/i18n/catalogs.ts`, `src/i18n/index.tsx`, `src/i18n/index.test.ts`, `src/components/LanguageButton.tsx`; modify `src/main.tsx`.

- [x] **Step 1: Write failing tests**

```ts
import { catalogs } from './catalogs';
import { formatMessage, normalizeLocale } from './index';

test('catalogs have identical keys', () => {
  expect(Object.keys(catalogs['zh-CN']).sort()).toEqual(Object.keys(catalogs.en).sort());
});
test('locale normalization is deterministic', () => {
  expect(normalizeLocale('zh-Hans-SG')).toBe('zh-CN');
  expect(normalizeLocale('en-US')).toBe('en');
  expect(normalizeLocale('fr')).toBe('zh-CN');
});
test('interpolates values and falls back to English', () => {
  expect(formatMessage('zh-CN', 'town.capacity', { count: 8 })).toContain('8');
  expect(formatMessage('zh-CN', 'test.englishOnly')).toBe('English fallback');
});
```

- [x] **Step 2: Confirm red, implement, confirm green**

Run `npm test -- --runInBand src/i18n/index.test.ts`; expect missing-module failure. Implement these exact public contracts:

```ts
export type Locale = 'zh-CN' | 'en';
export function normalizeLocale(value?: string | null): Locale;
export function formatMessage(locale: Locale, key: MessageKey,
  values?: Record<string, string | number>): string;
export function I18nProvider(props: React.PropsWithChildren): JSX.Element;
export function useI18n(): {
  locale: Locale;
  setLocale(locale: Locale): void;
  t(key: MessageKey, values?: Record<string, string | number>): string;
};
```

Use `aitown.locale` in `localStorage`, default unsupported locales to `zh-CN`, set the document `lang`, fall back to English, and replace `{name}` placeholders as text. Wire a `LanguageButton` that displays `English` or `中文` and wrap the app provider in `src/main.tsx`.

- [x] **Step 3: Verify and commit**

Run `npm test -- --runInBand src/i18n/index.test.ts && npm run build`; expect PASS. Commit as `feat: add bilingual UI foundation`.

### Task 3: Localize every player-visible interface string

**Files:** Modify `src/App.tsx`, `src/components/FreezeButton.tsx`, `MessageInput.tsx`, `Messages.tsx`, `PlayerDetails.tsx`, button components, `src/toasts.ts`, and `src/index.css`.

- [x] **Step 1: Add a failing literal audit**

Scan touched TSX files with `readFileSync` and reject these JSX literals: `Help`, `Start conversation`, `Leave conversation`, `typing...`, `Walking over...`, `Accept`, and `Reject`. Run the i18n test and expect failure on upstream UI.

- [x] **Step 2: Replace literals through `useI18n()`**

Translate title, tagline, help, controls, conversation states, membership events, typing, input placeholder, empty state, Toast messages, modal/ARIA labels, and buttons. Format timestamps with `toLocaleString(locale)`. Add the language button to the footer.

- [x] **Step 3: Apply the approved presentation tokens**

Use body fallback `"Fusion Pixel", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif` and the palette dark teal `#173f43`, rice white `#f4ecd8`, cinnabar `#b84a3a`, lantern gold `#e6b85c` on touched surfaces while retaining readable contrast.

- [x] **Step 4: Verify and commit**

Run `npm test -- --runInBand src/i18n/index.test.ts && npm run build`; expect PASS. Commit as `feat: localize player interface`.

### Task 4: Add the Lighthouse Town setting, residents, and prompt language

**Files:** Create `data/worlds/lighthouse-town/manifest.ts`, `characters.ts`, `content.test.ts`, `convex/util/worldLocale.ts`, `worldLocale.test.ts`; modify `data/characters.ts`, `convex/init.ts`, and the prompt builders under `convex/agent/`.

- [x] **Step 1: Write failing content tests**

```ts
expect(lighthouseTown.id).toBe('lighthouse-town');
expect(lighthouseCharacters).toHaveLength(5);
for (const character of lighthouseCharacters) {
  expect(character.name['zh-CN']).toBeTruthy();
  expect(character.name.en).toBeTruthy();
  expect(character.identity['zh-CN']).toContain('灯塔镇');
  expect(character.identity.en).toContain('Lighthouse Town');
}
expect(buildWorldPrompt('zh-CN')).toContain('只使用自然的简体中文');
expect(buildWorldPrompt('en')).toContain('Respond in natural English');
```

Run the focused test and expect missing-module failure.

- [x] **Step 2: Implement bilingual content**

Create 林澜/Lin Lan, 沈砚/Shen Yan, 唐果/Tang Guo, 墨七/Mo Qi, 苏萤/Su Ying. Give each a public description, private identity, long-term plan, speaking style, relationship hook, and one consistent lighthouse clue in both languages.

- [x] **Step 3: Implement server locale and compatibility exports**

```ts
export type WorldLocale = 'zh-CN' | 'en';
export function getWorldLocale(env = process.env): WorldLocale {
  return env.WORLD_LOCALE === 'en' ? 'en' : 'zh-CN';
}
```

Map localized residents back to the existing `Descriptions` shape so schemas stay unchanged. Inject the world prompt before identity, memory, and recent conversation context.

- [x] **Step 4: Verify and commit**

Run focused tests plus `npm run build`; expect PASS. Commit as `feat: add Lighthouse Town world and residents`.

### Task 5: Make model providers environment-driven

**Files:** Create `convex/util/llmConfig.ts`, `llmConfig.test.ts`, `.env.example`; modify `convex/util/llm.ts` and `convex/schema.ts`.

- [x] **Step 1: Write failing provider tests**

```ts
expect(resolveLLMConfig({ LLM_PROVIDER: 'ollama' }).provider).toBe('ollama');
expect(resolveLLMConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'secret' }).chatModel)
  .toBe('gpt-4o-mini');
expect(() => resolveLLMConfig({ LLM_PROVIDER: 'custom', LLM_API_KEY: 'secret' }))
  .toThrow('LLM_API_URL');
expect(capturedError).not.toContain('secret');
```

Also cover Together.ai, positive integer dimensions, trailing slash removal, and key-free Ollama. Confirm missing-module failure.

- [x] **Step 2: Implement pure parsing and integrate**

Export `resolveLLMConfig(env)` plus `getLLMConfig()`. Make explicit `LLM_PROVIDER` authoritative; otherwise preserve upstream key detection. Read provider-specific model names and embedding dimensions with safe defaults. Preserve OpenAI-compatible chat/embedding URLs, Ollama handling, retries, and stop words. Truncate upstream errors to 500 characters and redact bearer-like secrets.

- [x] **Step 3: Add `.env.example`, verify, and commit**

Document `WORLD_LOCALE`, all four providers, model names, endpoints, and dimensions without real keys. Run provider tests and build; expect PASS. Commit as `feat: support configurable LLM providers`.

### Task 6: Replace map and character art

**Files:** Create PNGs and `asset-sources.md` under `public/assets/worlds/lighthouse-town/`; create `data/worlds/lighthouse-town/map.ts`, `spritesheets.ts`, `scripts/validate-world-assets.mjs`; modify `convex/init.ts` and `package.json`.

- [x] **Step 1: Add a failing asset validator**

Implement a Node script that reads PNG headers and exits nonzero unless tile images are multiples of 32 pixels, declared sprite rectangles are within bounds, map layer lengths equal `width * height`, every reference exists, and flood fill from each spawn reaches the lighthouse plaza. Add `"validate:world": "node scripts/validate-world-assets.mjs"`; run it and expect missing-asset failure.

- [x] **Step 2: Produce and record original pixel assets**

Create a 32-pixel-grid Jiangnan fantasy tileset with white walls, tiled roofs, water/lotus edges, stone paths, bridge pieces, tea house, academy, workshop, dock, lanterns, and lighthouse pieces. Create eight four-direction resident slots plus player frames with consistent bounds. Record date, process, prompt summary, and rights status in `asset-sources.md`.

- [x] **Step 3: Build and wire the playable map**

Export `mapwidth`, `mapheight`, `tilesetpath`, `tilesetpxw`, `tilesetpxh`, `tiledim`, `bgtiles`, `objmap`, and `animatedsprites`. Place the lighthouse centrally and connect all landmarks by walkable loops. Point sprite URLs at `/ai-town/assets/worlds/lighthouse-town/` while retaining current animation names.

- [x] **Step 4: Verify and commit**

Run `npm run validate:world && npm test -- --runInBand && npm run build`; expect PASS. Commit as `feat: add original Lighthouse Town world art`.

### Task 7: Add Chinese operations documentation

**Files:** Create `README.zh-CN.md`; modify `README.md` and, only if needed, `docker-compose.yml`.

- [x] **Step 1: Add a failing documentation audit**

Make the validator require `npm run dev`, `docker compose up --build -d`, all four `LLM_PROVIDER` values, `WORLD_LOCALE`, and `npx convex run testing:wipeAllTables` in `README.zh-CN.md`. Run it and expect missing-document failure.

- [x] **Step 2: Write the guide**

Document cloud and Docker setup, Ollama/OpenAI/Together/custom examples, embedding migration, language behavior, customization, tests, troubleshooting, attribution, and license. Put a prominent data-loss warning immediately above the wipe command.

- [x] **Step 3: Verify and commit**

Run `npm run validate:world && npm run build`; expect PASS. Commit as `docs: add bilingual Lighthouse Town setup guide`.

### Task 8: Full verification and handoff

**Files:** Modify only files required by failures attributable to this feature.

- [x] **Step 1: Run all local checks**

```bash
npm run lint
npm test -- --runInBand
npm run validate:world
npm run build
docker compose config
git diff --check
```

Expected: all exit 0; any pre-existing upstream failure is reported with evidence rather than hidden.

- [ ] **Step 2: Browser smoke test**

Start `npm run dev:frontend`; verify Simplified Chinese default, English toggle, help modal, resident selection, desktop/mobile layout, and no browser console errors.

- [x] **Step 3: Repository hygiene and evidence**

Run `git status --short`, `git log --oneline --decorate -10`, and `git diff origin/main...HEAD --stat`. Confirm no secrets, `.env.local`, brainstorm output, or unrelated changes. Mark only actually completed plan checkboxes and commit the evidence update. Report cloud/model tests blocked by missing credentials separately.

### Verification record (2026-07-14)

- Passed: 74 Jest tests across 10 suites, production TypeScript/Vite build, Lighthouse Town asset/map validation, scoped ESLint for every changed TypeScript/JavaScript module, and `git diff --check`.
- Repository-wide `npm run lint` executes under Node 24 after renaming the config to `.eslintrc.cjs`, but reports 2,078 upstream issues (2,033 errors and 45 warnings), primarily in the legacy level editor. These are outside this feature; changed modules pass the same rules.
- Docker verification is blocked because the local machine has no `docker` executable. Cloud/provider live tests are blocked by the absence of a running Convex deployment and model endpoint in this shell.
- Browser smoke testing remains unchecked: the in-app browser automation runtime failed to initialize under the current Node host, and the frontend has no live Convex backend to exercise resident selection or conversations.
- Hygiene audit found no committed API keys, `.env.local`, generated brainstorm output, or unrelated working-tree changes.
