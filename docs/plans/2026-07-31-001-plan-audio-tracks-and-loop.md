# Audio Tracks & Loop Regions — design

Card: 2026-07-31-001 · Branch `feat/audio-tracks-and-loop` · Worktree `D:/Temp/nls-audiotrack`
Engine branch `feat/audio-loop-region-and-seek` · Worktree `D:/Temp/nlr-audio`

## The complaint

Audio in Studio has no unified control surface.

- A story audio row has **no channel/track field at all** — the compiler hardcodes it by
  operation (`setBgm` → `Sound.bgm`, everything else → `Sound.sound`, dialogue → `Sound.voice`).
- A blueprint `Play Sound` node has a `soundChannel` inspector select — a *different*
  vocabulary, reachable nowhere else.
- The player's four preference volumes (`globalVolume`, `bgmVolume`, `voiceVolume`,
  `soundVolume`) are only reachable from blueprint preference nodes.
- A per-action `volume` silently multiplies with all of the above, and nothing in the UI
  says so. This is the "乘数令人疑惑".
- Intro→loop, the single most common VN music pattern, is not expressible.

## The concept: **Audio Track**

One project-level noun that every audio-producing surface points at.

```ts
interface ProjectAudioTrack {
    id: string;                            // stable; referenced by story / scene / blueprint / widget
    name: string;                          // author-facing
    channel: "bgm" | "voice" | "sound";    // engine mixer bus == which player slider governs it
    gain: number;                          // 0..2 — the multiplier, made explicit and editable
    fadeInMs: number;                      // default fade for plays on this track
    fadeOutMs: number;                     // default fade for stops on this track
    loop: boolean;                         // default loop policy
    builtin?: boolean;                     // the three seeded ones cannot be deleted
}
```

Seeded on first read (no migration step, no document version bump needed if absent ⇒ seed):

| id | name | channel | gain | fadeIn | fadeOut | loop |
|---|---|---|---|---|---|---|
| `music` | Music | `bgm` | 1 | 800 | 800 | true |
| `sfx` | SFX | `sound` | 1 | 0 | 0 | false |
| `voice` | Voice | `voice` | 1 | 0 | 0 | false |

**Resolution at compile / play time**

```
type   = track.channel
volume = clamp01((action.volume ?? 1) * track.gain)
fadeIn  = action.fadeMs ?? track.fadeInMs
fadeOut = action.fadeMs ?? track.fadeOutMs
loop    = action.loop   ?? track.loop
```

**What a track is NOT**: it is not a runtime-adjustable bus. The engine has exactly three
gain buses and one master, and those stay the player-facing knobs. A track is an
**authoring-time mix preset** that resolves to (bus, multiplier, defaults). Say this plainly
in the UI by showing which player slider each track lands on — do not imply more.

**Why this shape**: it needs no engine change, it makes the invisible multiplication visible
and editable, and adding "Ambience" or "UI" costs one row instead of a convention the author
has to remember.

## Loop regions: three markers, not two

`extras.audioLoop` grows one field. All three are optional and absent means the old behaviour.

| marker | field | meaning |
|---|---|---|
| In | `inMs` | where playback starts |
| Loop | `loopStartMs` | where playback returns to on each repeat (**new**) |
| Out | `outMs` | where it loops back from / stops |

`loopStartMs` unset ⇒ falls back to `inMs` (today's behaviour, bit-for-bit).
`loopStartMs > inMs` ⇒ **intro→loop**: the segment `inMs..loopStartMs` plays once, then
`loopStartMs..outMs` repeats forever. This is the standard single-file VN loop spec.

## Confirmed defects this round must fix

1. **`extras.audioLoop` does not work in Dev Mode or the shipped game.**
   `GameApp.tsx:1078` calls `compileStudioStoryToNlr({...})` **without `audioClips`**, and the
   compiler has no fallback (`storyCompiler.ts:490`). Only the in-editor scene preview passes it
   (`useStoryScenePreviewController.ts:404`). So every in/out point an author marks is silently
   ignored everywhere that matters.
2. **`loop: true` + an out point hard-stops after one pass.** `@narraleaf/sound`'s `createToken`
   sets `duration = endTime - startTime` and `SoundToken`'s constructor arms
   `setTimeout(stop, duration*1000)` **unconditionally** (`soundToken.ts:77-83`). The 0.21.0
   loop-region feature has never actually looped.
3. **Blueprint sound nodes silently no-op inside stage-slot surfaces.**
   `StageSlotSurfaceShell.tsx:166` builds a host API with no `onPlaySound`/`onStopSound`/… —
   so a button-click sound in a dialogue-box or choice UI does nothing, with no diagnostic.
4. **The Video widget bypasses the mixer entirely** — its `volume` is written straight to the
   DOM `<video>` element (`video/renderer.tsx:135`), ignoring every player volume preference.
5. **`Scene.setBackgroundMusic` is documented as a cross-fade but is not** — it `await`s the old
   track's full fade-out before starting the new one (`Scene.tsx:58-77`), leaving a silent gap.

## Milestones

- **M0 (engine)** — `loopStart` decoupled from `seek`; loop-region stop-timer fix; real crossfade
  on `setBackgroundMusic`; CHANGELOG.
- **M1** — track model + project Audio surface.
- **M2** — story layer: `trackId`, inspector rework, command params, compiler, defect 1.
- **M3** — loop authoring in the asset audio editor + shared region types.
- **M4** — blueprint + surface: track on sound nodes, fade-in pin, defects 3 and 4.

## Standing UI rules (from prior rounds — violating these gets the work rejected)

- Match existing interface style exactly. Reuse `Button`, `Select`, `EnhancedInput`,
  `NumericDraftEnhancedInput`, `controlButtonClass()`, the properties-framework fields,
  `ContextMenu`. No one-off widgets.
- **No explanatory or descriptive text in the UI.** No helper paragraphs, no `title` tooltips on
  an editing surface.
- **Never stack thin bars.** One status line of values, no labels — e.g.
  `0:02.40 ▸ 0:04.96 ⟲ 1:24.00 · 48000 Hz · 2 ch`.
- Prefer hover-reveal icon buttons and existing gestures over new visible controls.
- en + zh locale keys must both exist (a parity test enforces it).
