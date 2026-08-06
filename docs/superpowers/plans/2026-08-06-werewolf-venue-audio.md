# Immersive Werewolf Venue and Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated nine-seat werewolf venue with a deterministic judge, visible night actions for god-mode observers, correct night-first pacing, responsive round-table controls, and three-channel town/game audio.

**Architecture:** Keep the Convex werewolf state machine authoritative and add only a narrowly scoped observer projection for secret theatre cues. A React venue renders a derived judge/presentation model and reuses the existing legal-action mutation; a single audio controller owns BGM, ambience, SFX, persistence, ducking, and browser unlock. The normal town view remains mounted only when the venue is closed, while the Convex world continues regardless of which view is visible.

**Tech Stack:** React 18, TypeScript, Convex, Jest/ts-jest, CSS, Web Audio API, existing `@pixi/sound` dependency.

---

## File structure

- Create `src/components/werewolfJudge.ts`: deterministic judge copy, phase order, theatre cues and public/private labels.
- Create `src/components/werewolfJudge.test.ts`: judge order and secrecy tests.
- Create `src/components/WerewolfVenue.tsx`: full-screen table, judge, seat actions, timeline and human controls.
- Create `src/components/WerewolfVenue.test.ts`: source/derived-view contract tests.
- Create `src/components/werewolfVenueModel.ts`: seat geometry, current action cue, vote edges and speed options.
- Create `src/components/werewolfVenueModel.test.ts`: geometry and cue tests.
- Create `src/audio/townAudio.ts`: persisted settings and scene-to-layer mapping.
- Create `src/audio/townAudio.test.ts`: settings and scene tests.
- Create `src/audio/TownAudioProvider.tsx`: one browser audio owner and controls context.
- Create `src/components/TownSoundControl.tsx`: always-visible three-channel sound control.
- Modify `convex/werewolf/privacy.ts`: expose complete secret theatre data only in observe mode.
- Modify `convex/werewolf/privacy.test.ts`: prove participants still cannot receive secrets.
- Modify `convex/werewolf.ts`: pass session mode to the privacy projector.
- Modify `src/components/werewolfView.ts`: add observer cue fields used by venue.
- Modify `src/components/WerewolfPanel.tsx`: add “进入圆桌会场” action.
- Modify `src/components/EventBroadcast.tsx`: forward the venue-open callback.
- Modify `src/components/Game.tsx`: switch between town layout and the dedicated venue.
- Modify `src/components/buttons/MusicButton.tsx`: delegate to the shared controller and remain visible on mobile.
- Modify `src/index.css`: dedicated venue, responsive table, drawer, lighting and audio controls.
- Modify `src/App.tsx`: mount the shared audio provider.
- Modify `README.md`: document audio unlock, controls and licensing policy.

### Task 1: Add an observer-only secret theatre projection

**Files:**
- Modify: `convex/werewolf/privacy.ts`
- Modify: `convex/werewolf/privacy.test.ts`
- Modify: `convex/werewolf.ts`

- [ ] **Step 1: Write the failing privacy tests**

```ts
test('god observer receives night theatre actions while a player never does', () => {
  const state = stateWithSecrets();
  const observer = buildWerewolfViewerState(state, undefined, 'observe');
  expect(observer.observerSecrets?.roles['p:0']).toBe('werewolf');
  expect(observer.observerSecrets?.nightActions.some((a) => a.kind === 'wolf-vote')).toBe(true);

  const player = buildWerewolfViewerState(state, 'p:3', 'play');
  expect(player.observerSecrets).toBeUndefined();
  expect(JSON.stringify(player)).not.toMatch(/wolf-vote|seer-check/u);
});
```

- [ ] **Step 2: Run the privacy suite and verify the new call signature fails**

Run: `npm test -- --runInBand convex/werewolf/privacy.test.ts`  
Expected: FAIL because `buildWerewolfViewerState` accepts only two arguments and has no `observerSecrets`.

- [ ] **Step 3: Add the explicit observe-mode projection**

```ts
export type WerewolfObserverSecrets = {
  roles: Record<string, WerewolfRole>;
  nightActions: WerewolfRecordedAction[];
  pendingNightTargetId?: string;
  pendingPoisonTargetId?: string;
};

export function buildWerewolfViewerState(
  state: WerewolfState,
  viewerId?: string,
  mode: 'observe' | 'play' = viewerId ? 'play' : 'observe',
): WerewolfViewerState {
  // existing public and player-private projection
  if (!viewer && mode === 'observe') {
    result.observerSecrets = {
      roles: Object.fromEntries(state.seats.map((seat) => [seat.playerId, seat.role])),
      nightActions: state.actions.filter((action) => action.phase.startsWith('night-')),
      pendingNightTargetId: state.pendingNightTargetId,
      pendingPoisonTargetId: state.pendingPoisonTargetId,
    };
  }
  return result;
}
```

Pass the persisted session `mode` from both `viewerState` and observer snapshot call sites. Never infer god mode from missing authentication alone.

- [ ] **Step 4: Run privacy and integration tests**

Run: `npm test -- --runInBand convex/werewolf/privacy.test.ts convex/werewolf.integration.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/werewolf/privacy.ts convex/werewolf/privacy.test.ts convex/werewolf.ts convex/events.ts
git commit -m "feat: expose safe werewolf observer theatre cues"
```

### Task 2: Derive deterministic judge and venue presentation models

**Files:**
- Create: `src/components/werewolfJudge.ts`
- Create: `src/components/werewolfJudge.test.ts`
- Create: `src/components/werewolfVenueModel.ts`
- Create: `src/components/werewolfVenueModel.test.ts`
- Modify: `src/components/werewolfView.ts`

- [ ] **Step 1: Write failing model tests**

```ts
test('judge begins with night and never calls a running first round a vote', () => {
  expect(judgeCue({ phase: 'night-wolves', round: 1 }).line)
    .toBe('天黑请闭眼。狼人请睁眼，商量今晚的目标。');
  expect(judgeCue({ phase: 'day-voting', round: 1 }).line).toMatch(/开始投票/u);
});

test('nine seats form a stable ellipse and preserve seat order', () => {
  const points = venueSeatPositions(9);
  expect(points).toHaveLength(9);
  expect(points.map((point) => point.seatNumber)).toEqual([1,2,3,4,5,6,7,8,9]);
});
```

- [ ] **Step 2: Run tests and verify missing modules fail**

Run: `npm test -- --runInBand src/components/werewolfJudge.test.ts src/components/werewolfVenueModel.test.ts`  
Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement the complete derived models**

```ts
const judgeLines: Record<WerewolfPhase, string> = {
  'night-wolves': '天黑请闭眼。狼人请睁眼，商量今晚的目标。',
  'night-seer': '狼人请闭眼。预言家请睁眼并选择查验对象。',
  'night-witch': '预言家请闭眼。女巫请睁眼并决定是否用药。',
  dawn: '天亮了。现在公布昨夜结果。',
  'day-speaking': '从当前座位开始依次发言，请只讨论本局信息。',
  'day-voting': '发言结束，现在开始投票。',
  'runoff-speaking': '出现平票，请候选人依次补充发言。',
  'runoff-voting': '补充发言结束，现在重新投票。',
  hunter: '猎人可以选择发动技能，也可以放弃。',
  completed: '本局结束，现在公布身份与结果。',
};

export function venueSeatPositions(count = 9) {
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    return {
      seatNumber: index + 1,
      x: 50 + Math.cos(angle) * 41,
      y: 50 + Math.sin(angle) * 38,
    };
  });
}
```

Extend `WerewolfPanelState` with typed `observerSecrets` and keep all role/action fields optional so participant responses remain type-safe.

- [ ] **Step 4: Run model and existing panel tests**

Run: `npm test -- --runInBand src/components/werewolfJudge.test.ts src/components/werewolfVenueModel.test.ts src/components/werewolfView.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/werewolfJudge.ts src/components/werewolfJudge.test.ts src/components/werewolfVenueModel.ts src/components/werewolfVenueModel.test.ts src/components/werewolfView.ts
git commit -m "feat: model immersive werewolf judge and table"
```

### Task 3: Build the dedicated venue and reuse legal human actions

**Files:**
- Create: `src/components/WerewolfVenue.tsx`
- Create: `src/components/WerewolfVenue.test.ts`
- Modify: `src/components/WerewolfPanel.tsx`
- Modify: `src/components/EventBroadcast.tsx`
- Modify: `src/components/Game.tsx`

- [ ] **Step 1: Write failing venue contract tests**

```ts
test('venue exposes judge, table, speed, shrink and participant controls', () => {
  const source = readFileSync(new URL('./WerewolfVenue.tsx', import.meta.url), 'utf8');
  expect(source).toContain('狼人杀法官');
  expect(source).toContain('werewolf-round-table');
  expect(source).toContain('缩回小镇');
  expect(source).toContain("submitHumanAction");
});
```

- [ ] **Step 2: Run the venue test and verify it fails**

Run: `npm test -- --runInBand src/components/WerewolfVenue.test.ts`  
Expected: FAIL because `WerewolfVenue.tsx` does not exist.

- [ ] **Step 3: Implement the venue with a single shared snapshot**

```tsx
export default function WerewolfVenue({ worldId, onClose }: Props) {
  const snapshot = useQuery(api.werewolf.viewerState, { worldId }) as WerewolfPanelState | null | undefined;
  const submitAction = useMutation(api.werewolf.submitHumanAction);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const view = useMemo(() => buildWerewolfPanelView(snapshot), [snapshot]);
  const cue = judgeCue({ phase: snapshot?.phase ?? 'night-wolves', round: snapshot?.round ?? 1 });
  return <main className={`werewolf-venue is-${snapshot?.phase ?? 'loading'}`}>
    <header className="werewolf-venue-toolbar">
      <button onClick={onClose}>← 缩回小镇</button>
      <span>第 {snapshot?.round ?? 1} 轮 · {view.phaseLabel}</span>
      <button onClick={() => setSpeed(speed === 1 ? 2 : 1)}>{speed}×</button>
    </header>
    <section className="werewolf-judge" aria-label="狼人杀法官">⚖<strong>法官</strong><p>{cue.line}</p></section>
    <RoundTable snapshot={snapshot} />
    <HumanControls snapshot={snapshot} submitAction={submitAction} />
    <PublicTimeline entries={view.publicTimeline} />
  </main>;
}
```

Factor `HumanControls` inside the same file initially and use the exact `speech`, `target`, and `witch` mutation payloads already exercised by `WerewolfPanel`.

- [ ] **Step 4: Wire navigation without pausing the world**

Add `onOpenWerewolfVenue` through `Game → EventBroadcast → WerewolfPanel`. In `Game`, render `WerewolfVenue` when `venueOpen` is true and keep `useWorldHeartbeat()` above the conditional so the world continues.

- [ ] **Step 5: Run venue and affected UI tests**

Run: `npm test -- --runInBand src/components/WerewolfVenue.test.ts src/components/EventBroadcast.test.ts src/components/werewolfView.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/WerewolfVenue.tsx src/components/WerewolfVenue.test.ts src/components/WerewolfPanel.tsx src/components/EventBroadcast.tsx src/components/Game.tsx
git commit -m "feat: add dedicated werewolf round-table venue"
```

### Task 4: Add theatre pacing without changing game truth

**Files:**
- Create: `src/components/useWerewolfTheatre.ts`
- Create: `src/components/useWerewolfTheatre.test.ts`
- Modify: `src/components/WerewolfVenue.tsx`

- [ ] **Step 1: Write failing pure pacing tests**

```ts
test('night begins with a visible darkness transition and speed only changes dwell time', () => {
  expect(phaseDwellMs('night-wolves', 1)).toBe(6000);
  expect(phaseDwellMs('night-wolves', 2)).toBe(3000);
  expect(phaseDwellMs('dawn', 1)).toBe(5000);
});
```

- [ ] **Step 2: Run the pacing test and verify it fails**

Run: `npm test -- --runInBand src/components/useWerewolfTheatre.test.ts`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement a presentation-only clock**

```ts
const dwell: Record<WerewolfPhase, number> = {
  'night-wolves': 6000, 'night-seer': 4000, 'night-witch': 4000,
  dawn: 5000, 'day-speaking': 5000, 'day-voting': 5000,
  'runoff-speaking': 4000, 'runoff-voting': 4000, hunter: 4000, completed: 8000,
};
export const phaseDwellMs = (phase: WerewolfPhase, speed: 1 | 2) => dwell[phase] / speed;
```

The hook stores only `lastSeenPhase`, `enteredAt`, and `skipToken`. It may delay a CSS transition but must never delay, submit, or replay a Convex action.

- [ ] **Step 4: Add visible night, target, dawn and vote cues**

Use `observerSecrets` only when present. Render wolf glow and target marker during night; render role-neutral sleeping icons for participants; render public vote edges only after votes are public.

- [ ] **Step 5: Run pacing and venue tests**

Run: `npm test -- --runInBand src/components/useWerewolfTheatre.test.ts src/components/WerewolfVenue.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/useWerewolfTheatre.ts src/components/useWerewolfTheatre.test.ts src/components/WerewolfVenue.tsx
git commit -m "feat: stage visible werewolf night and voting phases"
```

### Task 5: Build the three-channel audio state model

**Files:**
- Create: `src/audio/townAudio.ts`
- Create: `src/audio/townAudio.test.ts`

- [ ] **Step 1: Write failing audio-model tests**

```ts
test('loads bounded settings and maps scenes to distinct sound layers', () => {
  expect(normalizeAudioSettings({ music: 4, ambience: -1, effects: 0.5 })).toEqual({
    enabled: true, music: 1, ambience: 0, effects: 0.5,
  });
  expect(audioSceneForWerewolfPhase('night-wolves')).toBe('werewolf-night');
  expect(audioSceneForWerewolfPhase('day-speaking')).toBe('werewolf-day');
});
```

- [ ] **Step 2: Run and verify missing-module failure**

Run: `npm test -- --runInBand src/audio/townAudio.test.ts`  
Expected: FAIL because `townAudio.ts` does not exist.

- [ ] **Step 3: Implement serializable settings and scene mapping**

```ts
export type AudioSettings = { enabled: boolean; music: number; ambience: number; effects: number };
export type AudioScene = 'town' | 'werewolf-lobby' | 'werewolf-night' | 'werewolf-day' | 'werewolf-vote' | 'werewolf-result' | 'paused';
const clamp = (value: unknown, fallback: number) => typeof value === 'number' ? Math.max(0, Math.min(1, value)) : fallback;
export function normalizeAudioSettings(value: Partial<AudioSettings> = {}): AudioSettings {
  return { enabled: value.enabled ?? true, music: clamp(value.music, .55), ambience: clamp(value.ambience, .35), effects: clamp(value.effects, .7) };
}
```

- [ ] **Step 4: Run audio tests**

Run: `npm test -- --runInBand src/audio/townAudio.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audio/townAudio.ts src/audio/townAudio.test.ts
git commit -m "feat: model town and werewolf audio scenes"
```

### Task 6: Implement one shared browser audio owner and controls

**Files:**
- Create: `src/audio/TownAudioProvider.tsx`
- Create: `src/components/TownSoundControl.tsx`
- Create: `src/components/TownSoundControl.test.ts`
- Modify: `src/components/buttons/MusicButton.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Game.tsx`
- Modify: `src/components/WerewolfVenue.tsx`

- [ ] **Step 1: Write failing source-contract tests**

```ts
test('sound control exposes unlock and all three channels on mobile', () => {
  const source = readFileSync(new URL('./TownSoundControl.tsx', import.meta.url), 'utf8');
  expect(source).toContain('开启声音');
  expect(source).toContain('音乐');
  expect(source).toContain('环境');
  expect(source).toContain('音效');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --runInBand src/components/TownSoundControl.test.ts`  
Expected: FAIL because the control does not exist.

- [ ] **Step 3: Implement provider ownership and browser unlock**

```tsx
const TownAudioContext = createContext<TownAudioApi | null>(null);
export function TownAudioProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState(loadAudioSettings);
  const [unlocked, setUnlocked] = useState(false);
  const [scene, setScene] = useState<AudioScene>('town');
  const unlock = async () => {
    await ensureAudioContext().resume();
    setUnlocked(true);
  };
  useEffect(() => saveAudioSettings(settings), [settings]);
  useEffect(() => applyAudioScene({ scene, settings, unlocked }), [scene, settings, unlocked]);
  return <TownAudioContext.Provider value={{ settings, unlocked, scene, unlock, setScene, setChannel, toggleMute, playEffect }}>{children}</TownAudioContext.Provider>;
}
```

Use the existing `/ai-town/assets/background.mp3` for town music. Generate lightweight licensed-in-project procedural layers with Web Audio oscillators/noise for night ambience, day room tone and short event cues; cap nodes and disconnect them on every scene change.

- [ ] **Step 4: Mount once and remove duplicate background ownership**

Wrap the app in `TownAudioProvider`. Change `MusicButton` to use the context rather than calling `sound.add` itself. `Game` sets `town`/`paused`; `WerewolfVenue` sets the phase-derived scene and plays one-shot cues when the phase changes.

- [ ] **Step 5: Run audio and component tests**

Run: `npm test -- --runInBand src/audio/townAudio.test.ts src/components/TownSoundControl.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/audio/TownAudioProvider.tsx src/components/TownSoundControl.tsx src/components/TownSoundControl.test.ts src/components/buttons/MusicButton.tsx src/App.tsx src/components/Game.tsx src/components/WerewolfVenue.tsx
git commit -m "feat: add persistent three-channel town audio"
```

### Task 7: Style desktop and mobile venue layouts

**Files:**
- Modify: `src/index.css`
- Create: `src/components/WerewolfVenue.responsive.test.ts`

- [ ] **Step 1: Write failing responsive contract test**

```ts
test('venue has desktop, tablet and phone layout rules', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  expect(css).toMatch(/\.werewolf-venue/);
  expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.werewolf-round-table/);
  expect(css).toMatch(/\.town-sound-control/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --runInBand src/components/WerewolfVenue.responsive.test.ts`  
Expected: FAIL because venue CSS is absent.

- [ ] **Step 3: Implement responsive CSS**

```css
.werewolf-venue { min-height: 100dvh; display: grid; grid-template: auto auto 1fr / minmax(0, 1fr) minmax(260px, 340px); background: radial-gradient(circle at 45% 45%, #273650, #08131e 72%); color: #f8edcf; }
.werewolf-stage { position: relative; min-height: 0; overflow: hidden; }
.werewolf-round-table { position: absolute; inset: 18% 11% 14%; border: 24px solid #8b5938; border-radius: 50%; background: radial-gradient(ellipse, #b8814f 0 42%, #251c19 44%); }
.town-sound-control { position: fixed; z-index: 30; right: 12px; top: 12px; }
@media (max-width: 760px) {
  .werewolf-venue { grid-template: auto auto minmax(55dvh, 1fr) auto / 1fr; }
  .werewolf-round-table { inset: 20% 5% 12%; border-width: 14px; }
  .werewolf-venue-log { max-height: 32dvh; border-radius: 18px 18px 0 0; }
}
```

Add `prefers-reduced-motion` fallbacks and minimum 44px touch targets. Ensure the sound button never inherits the old `hidden lg:block` class.

- [ ] **Step 4: Run responsive and venue tests**

Run: `npm test -- --runInBand src/components/WerewolfVenue.responsive.test.ts src/components/WerewolfVenue.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/components/WerewolfVenue.responsive.test.ts
git commit -m "feat: polish responsive werewolf venue"
```

### Task 8: Document, fully verify and deploy

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document controls and audio licensing**

Add a concise section covering `M`, three channel sliders, browser unlock, god observer versus participant privacy, procedural in-project cues, and the policy that future audio files require distributable licenses.

- [ ] **Step 2: Run focused werewolf tests**

Run: `npm test -- --runInBand convex/werewolf/privacy.test.ts convex/werewolf.e2e.test.ts src/components/werewolfJudge.test.ts src/components/werewolfVenueModel.test.ts src/components/WerewolfVenue.test.ts src/audio/townAudio.test.ts`  
Expected: all suites PASS.

- [ ] **Step 3: Run full verification**

Run: `npm test -- --runInBand`  
Expected: all suites PASS.  
Run: `npm run build`  
Expected: TypeScript, Vite build and bundle validation PASS.  
Run: `git diff --check`  
Expected: no output.

- [ ] **Step 4: Push Convex functions and verify local preview**

Run: `npx convex run world:defaultWorldStatus '{}' --push --typecheck=disable`  
Expected: Convex functions ready.  
Refresh `http://localhost:4174/ai-town`, enter the venue and verify night-first judge flow, visible observer knife target, hidden participant secrets, audio unlock, BGM transition, return to town, refresh recovery, desktop and phone viewport.

- [ ] **Step 5: Commit and push**

```bash
git add README.md
git commit -m "docs: explain immersive werewolf venue"
git push fork codex/daily-town-implementation
```

