# Audio buses: tracks become a real mixer

Card 2026-08-01-001 · Studio branch `feat/audio-bus-tree` · worktree `D:/Temp/nls-audiotrack`
Engine `D:/Dev/org/NarraLeaf/narraleaf-react` (`dev_nomen`, 0.22.0)
Sound package cloned at `D:/Dev/org/NarraLeaf/Sound` — **expected to stay untouched**, see §1.

## What is wrong with what shipped last round

An audio track was `(name, bus, gain, fades, loop)` where `bus` was one of the engine's three
fixed channels and `gain` was folded into the clip's volume **at compile time**. That made a track
an authoring-time preset, not a mixer strip. Three consequences:

- The author cannot create a real track, only a named multiplier that lands on someone else's bus.
- The **player** cannot adjust anything the author invented — only the fixed three.
- Fades on a track invented a default that never existed and silently changed existing projects.

The motivating case it cannot express: **per-character voice volume**. Many VNs let a player turn
one character down or off. That is a player preference, and it needs a real bus per character.

## §1 The enabling discovery

`@narraleaf/sound@0.1.0` has supported nested channels with cascading gain **all along**; the engine
just never used it. `channel.ts:14-16` says so in its own class comment.

- `createChannel(name, opts)` builds a child whose gain connects to the parent's (`channel.ts:56-63,129-144`)
- `getGainNode()` and `getParent()` are public (`channel.ts:69-71,292-294`)
- a token is routed into its own channel's gain (`channel.ts:105`)
- it is in the published `dist` types, not just source

So `voice/alice → voice → master` is two `createChannel` calls. **No change to that package is
required**, and no second publish chain. Two smaller things would still want it, both optional:
`Channel.setVolume` clamps 0..1 (a bus can attenuate, never boost) and writes `gain.value` bare with
no `cancelScheduledValues` (`channel.ts:167-176`), which is the slider zipper.

## §2 The model

```ts
interface ProjectAudioTrack {
    id: string;            // stable; also the engine bus id
    name: string;
    parentId: string | null;   // null = directly under master
    volume: number;            // 0..1, the bus's own gain — LIVE, not folded into clips
    loop: boolean;             // default loop policy for clips on this track
    builtin?: true;            // the three seeded ones
}
```

Gone: `channel` (the track **is** the bus) and `fadeInMs`/`fadeOutMs` (see §3).

Seeded, with ids matching what existing content and existing saves already reference:

| id | name | parent |
|---|---|---|
| `bgm` | Music | — |
| `sound` | SFX | — |
| `voice` | Voice | — |

They are ordinary tracks: renameable, re-parentable, adjustable. The author adds peers and children
freely — `voice → alice`, `bgm → ambience`.

**Effective volume is now a graph, not a formula.** A clip's authored volume sits on its token; every
bus between it and the destination multiplies. The player moving any bus applies immediately to
everything already playing, because that is what the gain graph does (`AudioManager.ts:650-654` →
`channel.ts:167-176`, token gain connected at `soundToken.ts:63` ← `channel.ts:105`).

## §3 Fades are removed from the track — decided

A fade is a property of **the moment**, not of a category. The same music fades in over 3s at a
chapter open, cuts hard on a jump-scare, fades out over 8s at an ending. Bus and gain are stable
across a whole game; a fade is not.

Every surface already has its own explicit fade — `/bgm` `/sound` `/stop` `/pause` `/resume` take
`fade`, scene BGM has `fadeMs`, blueprint Play/Stop Sound have fade pins — so the track fade was
**pure default-filler**, and it invented a default that did not previously exist (empty meant a hard
cut). It also silently changed existing projects and produced an unlabelled inherited number in the
story row status line that no author had typed.

Absent fade means 0 again, exactly as before last round.

## §4 Engine work

| # | Item |
|---|---|
| E1 | `AudioManager` builds channels from a **declared bus tree** (host-supplied at boot) instead of enumerating `SoundType`. `reset()` re-enumerates the registry, not the enum (`AudioManager.ts:49-51,71-76,633-641`). |
| E2 | `Sound.config.type` accepts an arbitrary bus id while keeping `SoundType` exported and its three values valid. **`SoundType` is a public export** (`common/types.ts:35` → `src/index.ts`), so this must widen, not replace. |
| E3 | `scene.ts:183` `validateVoice` and `scene.ts:832` bgm-slot check are equality tests that **throw**. They must become "is a descendant of `voice` / `bgm`", or a voice on `voice/alice` fails story compile. This is the blocker for the whole motivating case. |
| E4 | Per-bus volume API. `Preference`'s value type forbids a nested map (`preference.ts:9`) and `GamePreference` is a closed object type, so **do not** widen the preference key union. Expose a dedicated bus-volume API and keep the four existing volume preferences as **aliases** onto the seeded buses. |
| E5 | **Bug**: `Preference` stores the defaults object by reference and mutates it (`preference.ts:18,23`), and `game.ts:167` passes the module-level `Game.DefaultPreference` — so every `Game` shares one settings object and a player's volume change mutates the static default. Clone it. |
| E6 | Ramp bus volume changes (`setTargetAtTime`, ~20ms) so a slider drag stops zippering. Driving the gain param from `AudioManager` means `Channel.volume` bookkeeping drifts — decide and document which owns the value. |
| E7 | `maxChannels` defaults to 128 and the engine passes no options (`AudioManager.ts:61`); a large voiced cast can hit the cap (`sound.ts:372-378`). Pass an explicit, larger value. |
| E8 | `AudioManager.test.ts:188,191` asserts created channels **equal** `Object.values(SoundType)` — update. |
| E9 | CHANGELOG + version bump + publish, per the documented release flow. |

Validation belongs **above** the graph: the package cannot cycle by construction, but the author's
declarative `{id, parentId}` can. Resolve topologically with a visited set, reject unknown parents,
cap depth. Note `Channel.remove()` stops every token in its subtree (`channel.ts:222-225`), so the
tree is realized at boot and not live-reconfigured.

## §5 Studio work

- **Model + migration.** v1 docs (`channel`/`gain`/fades) migrate: `channel` → `parentId`,
  `gain` → `volume`, fades dropped.
- **Project → Audio, rebuilt.** Every sibling section (Details/Game/Runtimes/Linting) is built on the
  shared `SettingRow`/`SettingShell`, which render a **visible title and description** per control.
  The audio section used bare inputs whose only label was an invisible `aria-label`. It must match its
  neighbours. Controls: name, parent, volume, default loop. Nothing else.
- **Persistence.** Studio never persists volume preferences — `exportPreferences`/`importPreferences`
  have no call sites and no volume ever reaches `scope.persistenceSet`. Player bus volumes must
  persist, or "mute Bob" resets on every launch.
- **Runtime wiring.** The bundle carries the tree; the host declares it at boot.
- **Blueprint.** `Get/Set Track Volume` taking a track id with dynamic options, replacing the four
  fixed nodes (kept as aliases). Also fix the **name collision**: `Set Sound Volume` currently exists
  twice — the sound-transport node and the preference node share a display name.
- **Compile.** A clip's volume is no longer pre-multiplied by the track's gain; the bus does it live.
- **Per-character voice.** Characters gain a voice track; dialogue voice compiles onto it.

## §6 Standing rules

- Match the neighbouring surface's conventions. In **project settings** that means labelled rows with
  descriptions — the "no explanatory text" rule is about **editing surfaces** (story canvas,
  waveform), and applying it here is what produced an unreadable panel.
- Reuse `Button`, `Select`, `EnhancedInput`, `NumericDraftEnhancedInput`, `SettingRow`/`SettingShell`.
- en + zh locale keys both required; a parity test enforces it.
- Never write a raw NUL or control byte into source — git then treats the file as binary.
- Kill processes **by PID only**. Never `taskkill /IM`.
