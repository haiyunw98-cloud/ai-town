# Lighthouse Town Original Music and Judge Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the silent/single-track audio prototype with original local BGM, reliable one-click playback, and a female local-TTS judge whose speech stays synchronized with complete werewolf subtitles.

**Architecture:** A deterministic Node generator creates five original loopable WAV assets and a checked manifest. `TownAudioProvider` becomes the single mixer for two cross-faded BGM elements, ambience, effects, visibility/pause state, and explicit browser unlock; a separate `useJudgeVoice` hook owns local `speechSynthesis`, female Chinese voice selection, deduplication, cancellation, and BGM ducking. Presentation-only intro cues live above the authoritative werewolf state machine, while every conditional gameplay cue remains derived from real persisted phases.

**Tech Stack:** TypeScript, React, Web Audio API, HTMLAudioElement, Web Speech API, Node.js PCM/WAV generation, Jest, Vite, Convex.

---

## File Structure

- Create `scripts/generate-lighthouse-audio.mjs`: deterministic composition renderer and WAV encoder.
- Create `scripts/lighthouseAudioGenerator.test.ts`: musical event, duration, peak and WAV-header tests.
- Create `public/assets/audio/lighthouse-town/manifest.json`: runtime metadata, generation prompts and license note.
- Create five generated WAV files beside the manifest.
- Modify `package.json`: add `audio:generate` and `audio:validate` commands.
- Modify `src/audio/townAudio.ts`: four-channel settings, scene-to-track mapping and playback status types.
- Modify `src/audio/townAudio.test.ts`: settings and scene-track tests.
- Modify `src/audio/TownAudioProvider.tsx`: dual-deck BGM, explicit unlock, crossfade, errors and status.
- Create `src/audio/judgeVoice.ts`: pure female-Chinese voice selection and utterance-key helpers.
- Create `src/audio/judgeVoice.test.ts`: voice priority and dedupe tests.
- Create `src/audio/useJudgeVoice.ts`: speech lifecycle and ducking hook.
- Modify `src/components/werewolfJudge.ts`: intro cues and complete judge copy.
- Modify `src/components/werewolfJudge.test.ts`: full sequence assertions.
- Modify `src/components/useWerewolfTheatre.ts`: new-game intro queue only.
- Modify `src/components/useWerewolfTheatre.test.ts`: intro/recovery/branch tests.
- Modify `src/components/WerewolfVenue.tsx`: voice hook, speaking indicator and exact subtitle source.
- Modify `src/components/TownSoundControl.tsx`: voice volume, current track, voice and playback/error state.
- Modify `src/components/TownSoundControl.test.ts`: four channels and status UI.
- Modify `src/index.css`: speaking pulse and sound status layout.
- Modify `README.md`: document original tracks, local female voice and browser unlock.

### Task 1: Deterministic Original Music Renderer

**Files:**
- Create: `scripts/generate-lighthouse-audio.mjs`
- Create: `scripts/lighthouseAudioGenerator.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing generator contract test**

```ts
import { readFileSync } from 'node:fs';

describe('Lighthouse Town original audio generator', () => {
  test('defines five distinct safe loop compositions', () => {
    const source = readFileSync(new URL('./generate-lighthouse-audio.mjs', import.meta.url), 'utf8');
    for (const id of ['town-day', 'werewolf-night', 'werewolf-discussion', 'werewolf-vote', 'werewolf-result']) {
      expect(source).toContain(`'${id}'`);
    }
    expect(source).toContain('RIFF');
    expect(source).toContain('writeInt16LE');
    expect(source).not.toMatch(/海浪|汽笛|horror|scream/ui);
  });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- --runInBand scripts/lighthouseAudioGenerator.test.ts`

Expected: FAIL because `generate-lighthouse-audio.mjs` does not exist.

- [ ] **Step 3: Implement a deterministic PCM composer**

The generator exports `COMPOSITIONS`, `renderComposition` and `encodeWav`. Use mono 22,050 Hz, 16-bit PCM, deterministic seeded noise, pentatonic note tables, attack/release envelopes and a 250 ms equal-power loop crossfade. Define:

```js
export const COMPOSITIONS = {
  'town-day': { seconds: 72, bpm: 78, seed: 1107, palette: 'jiangnan-warm' },
  'werewolf-night': { seconds: 64, bpm: 62, seed: 2201, palette: 'qin-night' },
  'werewolf-discussion': { seconds: 68, bpm: 84, seed: 3301, palette: 'wood-dialogue' },
  'werewolf-vote': { seconds: 48, bpm: 96, seed: 4409, palette: 'tense-vote' },
  'werewolf-result': { seconds: 24, bpm: 76, seed: 5519, palette: 'bright-resolution' },
};
```

Render soft sine/triangle plucks, filtered deterministic noise, wooden percussion and bounded peak amplitude `<= 0.86`. The script writes files only when invoked directly.

- [ ] **Step 4: Add generation commands**

```json
"audio:generate": "node scripts/generate-lighthouse-audio.mjs",
"audio:validate": "node scripts/generate-lighthouse-audio.mjs --validate"
```

- [ ] **Step 5: Run the focused test**

Run: `npm test -- --runInBand scripts/lighthouseAudioGenerator.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-lighthouse-audio.mjs scripts/lighthouseAudioGenerator.test.ts package.json
git commit -m "feat: add deterministic lighthouse music renderer"
```

### Task 2: Generate and Validate the Five Audio Assets

**Files:**
- Create: `public/assets/audio/lighthouse-town/town-day.wav`
- Create: `public/assets/audio/lighthouse-town/werewolf-night.wav`
- Create: `public/assets/audio/lighthouse-town/werewolf-discussion.wav`
- Create: `public/assets/audio/lighthouse-town/werewolf-vote.wav`
- Create: `public/assets/audio/lighthouse-town/werewolf-result.wav`
- Create: `public/assets/audio/lighthouse-town/manifest.json`
- Modify: `scripts/lighthouseAudioGenerator.test.ts`

- [ ] **Step 1: Add a failing asset validation test**

```ts
test.each(expectedTracks)('$id is a non-silent valid WAV', ({ id, minimumSeconds }) => {
  const bytes = readFileSync(new URL(`../public/assets/audio/lighthouse-town/${id}.wav`, import.meta.url));
  expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  expect(bytes.subarray(8, 12).toString()).toBe('WAVE');
  expect(bytes.length).toBeGreaterThan(22050 * 2 * minimumSeconds);
  expect(new Set(bytes.subarray(44, 4096))).not.toEqual(new Set([0]));
});
```

- [ ] **Step 2: Verify missing assets fail**

Run: `npm test -- --runInBand scripts/lighthouseAudioGenerator.test.ts`

Expected: FAIL with missing WAV files.

- [ ] **Step 3: Generate files and manifest**

Run: `npm run audio:generate`

The manifest must include for each track: `id`, Chinese title, scene, seconds, sample rate, loop-safe flag, SHA-256, generation description and `license: "Original project-generated audio; MIT project distribution"`.

- [ ] **Step 4: Validate audio**

Run: `npm run audio:validate`

Expected: five `valid` lines, bounded peaks and matching manifest hashes.

- [ ] **Step 5: Run tests and commit**

```bash
npm test -- --runInBand scripts/lighthouseAudioGenerator.test.ts
git add public/assets/audio/lighthouse-town scripts/lighthouseAudioGenerator.test.ts
git commit -m "feat: add original lighthouse town soundtrack"
```

### Task 3: Reliable Dual-Deck Audio Mixer and One-Click Unlock

**Files:**
- Modify: `src/audio/townAudio.ts`
- Modify: `src/audio/townAudio.test.ts`
- Modify: `src/audio/TownAudioProvider.tsx`
- Modify: `src/components/TownSoundControl.test.ts`

- [ ] **Step 1: Write failing scene and unlock-contract tests**

```ts
expect(trackForScene('town')).toContain('town-day.wav');
expect(trackForScene('werewolf-night')).toContain('werewolf-night.wav');
expect(trackForScene('werewolf-day')).toContain('werewolf-discussion.wav');
expect(trackForScene('werewolf-vote')).toContain('werewolf-vote.wav');
expect(DEFAULT_AUDIO_SETTINGS.voice).toBeGreaterThan(0);

const provider = readFileSync(new URL('../audio/TownAudioProvider.tsx', import.meta.url), 'utf8');
expect(provider).toContain('await activeDeck.play()');
expect(provider).toContain('setPlaybackError');
expect(provider).toContain('crossfadeDecks');
```

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- --runInBand src/audio/townAudio.test.ts src/components/TownSoundControl.test.ts`

Expected: FAIL for missing track mapping, voice channel and explicit play.

- [ ] **Step 3: Extend settings and scene mapping**

```ts
export type AudioChannel = 'music' | 'ambience' | 'effects' | 'voice';
export const TRACKS: Record<AudioScene, string | undefined> = {
  town: '/ai-town/assets/audio/lighthouse-town/town-day.wav',
  'werewolf-night': '/ai-town/assets/audio/lighthouse-town/werewolf-night.wav',
  'werewolf-day': '/ai-town/assets/audio/lighthouse-town/werewolf-discussion.wav',
  'werewolf-vote': '/ai-town/assets/audio/lighthouse-town/werewolf-vote.wav',
  'werewolf-result': '/ai-town/assets/audio/lighthouse-town/werewolf-result.wav',
  paused: undefined,
};
```

Normalize and persist `voice` exactly like the other channels.

- [ ] **Step 4: Replace the single element with two cross-faded decks**

`TownAudioProvider` owns deck A and deck B. `unlock()` must create both decks, enable settings, resume the context, set the current source and execute `await activeDeck.play()` inside the click call stack. Set `unlocked=true` only after play succeeds. On scene change, start the inactive deck at volume zero, then fade old/new volumes over 600 ms before pausing the old deck.

Expose:

```ts
type PlaybackStatus = {
  currentTrack?: string;
  playing: boolean;
  playbackError?: string;
};
```

Do not swallow `play()` rejection. Store `无法播放音乐，请再次点击“开启声音”。` and keep the unlock button available.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --runInBand src/audio/townAudio.test.ts src/components/TownSoundControl.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/audio src/components/TownSoundControl.test.ts
git commit -m "fix: make town soundtrack reliably audible"
```

### Task 4: Local Female Judge Voice Engine

**Files:**
- Create: `src/audio/judgeVoice.ts`
- Create: `src/audio/judgeVoice.test.ts`
- Create: `src/audio/useJudgeVoice.ts`
- Modify: `src/audio/TownAudioProvider.tsx`

- [ ] **Step 1: Write failing voice selection tests**

```ts
expect(selectJudgeVoice([
  voice('Reed', 'zh-CN'), voice('Tingting', 'zh-CN'), voice('Alex', 'en-US'),
])?.name).toBe('Tingting');
expect(selectJudgeVoice([voice('中文系统声', 'zh-CN')])?.name).toBe('中文系统声');
expect(judgeUtteranceKey('s:1', 2, 'dawn', 0)).toBe('s:1:2:dawn:0');
```

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- --runInBand src/audio/judgeVoice.test.ts`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement pure voice selection**

Prioritize exact local names `Tingting`, `Flo`, `Sandy`, `Shelley`, then any `zh-CN`/`zh_CN`, then default. Reject remote-service-specific logic. Implement stable utterance keys and `shouldSpeakJudgeCue(lastKey, nextKey, enabled)`.

- [ ] **Step 4: Implement `useJudgeVoice`**

The hook receives `{ key, text, enabled, volume, onSpeakingChange }`. It loads voices both immediately and through `voiceschanged`, creates one `SpeechSynthesisUtterance` with `lang='zh-CN'`, `rate=0.95`, `pitch=1.06`, cancels obsolete speech, speaks once per key, and reports `{ supported, speaking, voiceName, error }`. Cleanup cancels speech. Page hidden, paused or venue unmounted cancels without replaying stale text.

- [ ] **Step 5: Connect voice ducking**

On `speaking=true`, call the provider's dedicated judge duck setter; calculate effective music volume from visibility duck OR judge duck without sharing timers.

- [ ] **Step 6: Run tests and commit**

```bash
npm test -- --runInBand src/audio/judgeVoice.test.ts src/components/TownSoundControl.test.ts
git add src/audio
git commit -m "feat: add local female werewolf judge voice"
```

### Task 5: Complete Judge-Led Presentation Sequence

**Files:**
- Modify: `src/components/werewolfJudge.ts`
- Modify: `src/components/werewolfJudge.test.ts`
- Modify: `src/components/useWerewolfTheatre.ts`
- Modify: `src/components/useWerewolfTheatre.test.ts`
- Modify: `src/components/WerewolfVenue.tsx`

- [ ] **Step 1: Write failing full-sequence tests**

```ts
expect(newGameIntroSteps()).toEqual([
  'intro-welcome', 'intro-seating', 'intro-roles',
]);
expect(judgeCue({ phase: 'intro-welcome', round: 1 }).line).toContain('欢迎来到灯塔镇狼人杀');
expect(judgeCue({ phase: 'intro-roles', round: 1 }).line).toContain('身份已经发放');
expect(judgeCue({ phase: 'completed', round: 2, winner: 'good' }).line).toContain('好人阵营获胜');
```

Also retain tests proving recovery does not replay intro, `night-* → day-speaking` inserts only required `dawn`, and `day-voting → completed` does not invent runoff or hunter.

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- --runInBand src/components/werewolfJudge.test.ts src/components/useWerewolfTheatre.test.ts`

Expected: FAIL for missing intro cues and dynamic winner copy.

- [ ] **Step 3: Extend presentation-only cue types**

```ts
export type JudgePresentationPhase = WerewolfPhase |
  'intro-welcome' | 'intro-seating' | 'intro-roles';
```

Only `replayOpening=true` adds intro cues. Existing sessions opened with `replayOpening=false` start at the real snapshot. Expand judge copy for target confirmation, dawn result, named speaker, vote, runoff, hunter, winner and return-to-town instruction using real state only.

- [ ] **Step 4: Make one cue the source for subtitle and TTS**

In `WerewolfVenue`, compute `judge.line` once, render it in the subtitle, and pass the same string plus stable presentation key to `useJudgeVoice`. Display `正在播报` while speaking. Do not create a second text template inside the voice hook.

- [ ] **Step 5: Run focused tests and commit**

```bash
npm test -- --runInBand src/components/werewolfJudge.test.ts src/components/useWerewolfTheatre.test.ts src/components/WerewolfVenue.test.ts
git add src/components
git commit -m "feat: let the judge host the complete werewolf flow"
```

### Task 6: Four-Channel Sound UI and Honest Status

**Files:**
- Modify: `src/components/TownSoundControl.tsx`
- Modify: `src/components/TownSoundControl.test.ts`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing status UI tests**

```ts
expect(source).toContain("{ key: 'voice', label: '法官', icon: '◉' }");
expect(source).toContain('当前曲目');
expect(source).toContain('女法官声线');
expect(source).toContain('playbackError');
expect(source).toContain('正在播放');
```

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- --runInBand src/components/TownSoundControl.test.ts`

Expected: FAIL for the fourth channel and status labels.

- [ ] **Step 3: Implement honest controls**

Show four sliders: 音乐、环境、音效、法官。Show `当前曲目：<中文标题>` and one of `正在播放 / 等待开启 / 已暂停 / 播放失败`. In the venue show the selected female voice name. When `playbackError` exists, render a visible retry button wired to `unlock()`.

- [ ] **Step 4: Style desktop and phone layouts**

Keep every control at least 44 px tall. On phone, use a fixed sound sheet below the toolbar with no clipped sliders. The judge speaking indicator uses a restrained gold pulse and honors `prefers-reduced-motion`.

- [ ] **Step 5: Run tests and commit**

```bash
npm test -- --runInBand src/components/TownSoundControl.test.ts src/components/WerewolfVenue.responsive.test.ts
git add src/components/TownSoundControl.tsx src/components/TownSoundControl.test.ts src/index.css
git commit -m "feat: show soundtrack and judge voice status"
```

### Task 7: Documentation, Full Verification and Deployment

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the audible system**

Add the five track names, local female TTS behavior, four volume channels, first-click browser requirement, offline fallback and asset manifest path. State that no dialogue is sent to cloud TTS.

- [ ] **Step 2: Run full automated verification**

```bash
npm run audio:validate
npm test -- --runInBand
npm run build
npx eslint src/audio src/components/WerewolfVenue.tsx src/components/TownSoundControl.tsx src/components/werewolfJudge.ts src/components/useWerewolfTheatre.ts
git diff --check
```

Expected: audio validation passes five tracks; all Jest suites pass; TypeScript, Vite, client boundary and focused lint pass; no whitespace errors.

- [ ] **Step 3: Deploy local Convex and check persistent services**

```bash
npx convex run world:defaultWorldStatus '{}' --push --typecheck=disable
./scripts/check-lighthouse-site.sh
```

Expected: `Convex functions ready`, world status running, `frontend=200 backend=tcp-open archive=healthy`.

- [ ] **Step 4: Browser verification at the real URL**

Reload `http://localhost:4174/ai-town`. Click `开启声音` once and inspect that the active audio element is unpaused, volume is above zero and `currentTime` advances. Start observer werewolf, verify audible female intro and exact matching subtitle, distinct night/discussion/vote/result tracks, BGM ducking during speech, pause/mute/reload recovery, no premature role reveal, return to town music, and 390×844 controls.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain original soundtrack and judge voice"
```

- [ ] **Step 6: Independent review and push**

Request code review for the complete feature range, fix all Critical/Important findings, rerun Task 7 verification, then push `codex/daily-town-implementation` to `fork` without adding the untracked `.convex` directory.
