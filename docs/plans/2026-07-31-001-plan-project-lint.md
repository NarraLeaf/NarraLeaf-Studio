# Project Lint — plan and rulings

Card: 2026-07-31-001 · Branch `feat/project-lint` · Worktree `D:/Temp/nls-lint`

## 1. Problem

Studio has no project-wide lint. What exists today is a scatter of local,
always-on checks, each blind outside its own surface:

- `ui-editor/diagnostics/*` — one UI surface at a time, hardcoded rule array.
- `storyRowDiagnostics.ts` — one row at a time; its header explicitly refuses to
  be a problems panel.
- `storyCompiler.ts` — dangling goto / duplicate labels / unresolved assets, but
  per-scene and only at compile time.
- `BuildService.collectInvalidStoryBlocks()` — the one genuine project-wide
  sweep, single-purpose.
- `assetOverviewModel.ts` — referenced/orphan buckets, an audit of assets only.

Nothing answers "what is wrong with this project" in one pass. Ren'Py's `lint`
does; we ship less.

## 2. Rulings

**R1 — One engine, pure rules.** A rule is a pure function over a prepared
`LintContext` snapshot returning `LintFinding[]`. No rule touches a service, a
React hook, or the DOM. I/O-needing rules (asset decode) receive a narrow `io`
facade on the context. This is what makes 26 rules testable without a running app.

**R2 — Registry, not an array.** Every rule carries `id`, `category`,
`defaultSeverity`, i18n keys and an optional options schema. Config maps
`ruleId -> severity | "off"`. Adding a rule must not require touching the UI.

**R3 — Trigger: both, and the build gate is on by default.**
- Command palette `lint:project` — always available, **works while frozen**
  (read-only sweep; it is exempt in `freezeActionPolicy`).
- Build gate — `runOnBuild` default **true**, `failBuildOn` default `"error"`.
  Inserted in `BuildService.start()` *after* the existing invalid-block gate.
  Findings log into the `build` console channel; the build never reaches the
  main process when it fails.

**R4 — `collectInvalidStoryBlocks` stays where it is.** It is an unconditional
correctness gate; routing it through disableable config would let an author turn
off the check that stops a broken game from shipping. The lint rule
`story/invalid-command` *calls the same* `collectInvalidBlocks()` so a palette
run still reports them — same function, no second implementation.

**R5 — Unconfigured features are silent, not "off".** `voice/*` produces nothing
when the project has no `voicedLocales`; `localization/*` nothing when no target
locales. Defaulting them off would hide them from authors who later configure the
feature and never think to revisit the settings panel.

**R6 — Results open as an editor tab, not a new panel.** A project-wide report is
a document, and the workspace already opens documents in tabs. Findings carry a
`SearchJumpTarget`, so click-to-jump is `jumpToSearchTarget()` — existing
machinery, no new navigation code.

**R7 — No incremental/cached lint in v1.** Whole-project sweep with progress on
its own console channel, yielding between stories. Caching is a second round.

## 3. Rule set (26 rules, 7 categories)

| id | default | notes |
|---|---|---|
| `assets/unused` | warning | `ReferenceService.getReferencedAssetIds()` complement |
| `assets/missing` | error | a reference names an id absent from the library |
| `assets/unreadable` | error | bytes unreadable **or** image fails to decode |
| `portability/asset-name` | warning | `<>:"\|?*`, trailing dot/space, reserved DOS names |
| `portability/case-collision` | error | ids/names differing only by case |
| `portability/media-format` | warning | codec unplayable on a selected build target |
| `story/invalid-command` | error | reuses `collectInvalidBlocks()` |
| `story/goto-missing` | error | `/goto` label not declared in the scene |
| `story/label-duplicate` | warning | first declaration wins → silent misroute |
| `story/label-unused` | info | |
| `story/jump-missing` | error | `StoryJumpBlock.targetSceneId` absent |
| `story/empty-choice` | error | choice with no live option, or option with empty text |
| `story/dead-end` | warning | scene's last live block neither jumps nor ends |
| `story/unreachable-scene` | warning | not reachable from any entry or `game.startStory` |
| `story/empty-scene` | info | |
| `variables/undeclared` | error | used with no scene/saved/persistent declaration |
| `variables/unused` | warning | declared, never read or written |
| `variables/name-collision` | error | reuses `mergedPersistentView.nameCollisions` |
| `text/overlong` | warning | opts `{maxChars: 120, countMode: "eastAsianWidth"}` |
| `text/empty` | warning | |
| `localization/missing` | warning | absent unit or `status === "untranslated"` |
| `localization/stale` | warning | `isSourceHashStale()` |
| `localization/orphan` | info | unit whose `textId` no longer exists |
| `voice/missing` | warning | no voice unit and no legacy `voiceAssetId` |
| `voice/stale` | warning | `sourceHash` mismatch — text changed since recording |
| `voice/orphan` | info | |

`text/overlong` counts East-Asian wide characters as 2 by default: a 60-character
Chinese line overflows the same box a 120-character English one fits.

## 4. Work items

- **W1 — framework** (lands first, everything depends on it): types, config +
  normalizer, the complete 26-entry registry with **stubbed `run`**, context
  assembly, `LintService`, console channel, and **the full i18n key set for all 26
  rules in both catalogues**. Category rule files are created as empty-array stubs
  so W2–W4 never edit a shared file.
- **W2 — story + variables rules** (12)
- **W3 — assets + portability rules** (6)
- **W4 — text + localization + voice rules** (8)
- **W5 — Project → Linting settings section**
- **W6 — lint report editor tab, command palette entry, build gate**

W2–W6 run in parallel after W1. i18n and the registry aggregator belong to W1
alone; that is what keeps six agents off each other's files.

## 5. Acceptance (orchestrator, by eye)

Local checks (`npx tsc`, vitest) are necessary and not sufficient. The gate is:
open a real project, run lint from the palette, and see a report with real
findings; open Project → Linting and change a severity; run a build with a
seeded error-level finding and watch it refuse.
