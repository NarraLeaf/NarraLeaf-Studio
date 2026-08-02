# Test pipeline — plan and rulings (phase 1: framework + UI)

Card: 2026-08-01-002 · Branch `feat/test-pipeline` · Worktree `.claude/worktrees/test-pipeline`

## 1. Problem

Studio can *run* an author's game three ways (Dev Mode, Preview, Production Build) and *inspect* it
one way (project lint, 26 static rules). It cannot **check** it: there is no way to ask "does this
game reach an ending", "does it survive with no network", "did anything blow up while it played".
Every VN toolchain of consequence ships that; we ship a Run button.

Two gaps make it more than a UI exercise:

- **Studio cannot tell a crash from a clean quit.** `PreviewManager` logs every child exit at
  `verbose` and lets the polled status fall back to `idle`
  (`src/main/app/application/managers/preview/PreviewManager.ts:333`). "The author closed the
  window" and "the process died" are the same event today — and the first is the *pass* condition
  of the no-network test, the second the *fail*.
- **The game runtime has no uncaught-error hook.** No `window.onerror`, no `unhandledrejection`, no
  `uncaughtException`. An uncaught exception in a running game is reported nowhere; the only path
  back is `bridge.log()` (`src/runtime/preload/preload.ts:152`), which the game only calls
  deliberately. "Are there runtime errors" is currently unanswerable.

Phase 1 is the framework, the protocol and the interface. The two named built-in tests (general
ending-reachability, no-network) are phase 2.

## 2. Rulings

**R1 — Tests run in the workspace renderer.** Same process as the lint engine and as plugin editor
code (`pluginRuntime.ts` dynamic-imports plugin `studio` entries into the workspace window). The
project model a test reasons about lives there; main-process capabilities are reached over IPC the
way every other renderer service reaches them. No new sandbox, no second model.

**R2 — One registry, populated by core and plugins, ownership tracked.** Shape copied from
`WidgetModuleRegistry` (the flatter of the two precedents, and the one whose registrations are
*removable* — a plugin unload must reclaim its tests). Built-in tests seed idempotently via
`ensureBuiltInTestsRegistered()`; plugin registrations carry `ownerPluginId`, assigned by the host
from the registering plugin's identity and never read off the definition.

**R3 — `contributes.tests: string[]`.** Plugins declare their test ids in the manifest, each
prefixed with the plugin id; registering an undeclared id throws at load. Consistent with
`blueprintNodes` / `widgets`, and it lets the Launcher say what a plugin provides before its code
runs. **It derives no install permission**: a test executes only when the author picks it from the
dialog and presses Start, so there is no ambient capability to consent to. (Out-of-repo cost: the
registry's `schema/manifest.schema.json` is `additionalProperties: false` and must gain the key —
that schema is *already* behind, missing `locales`/`runtimeData`/`sidecars`; see §6.)

**R4 — A test may only say passed / failed / skipped.** `cancelled` and `errored` are verdicts the
host reaches about a test; a test that could claim them could lie about being killed. Cancellation
arrives as `ctx.signal`. A test whose contract is "close the window when satisfied" expresses
author-termination by catching the abort and returning `failed` — which is exactly the semantic the
no-network test needs, without the framework hard-coding it.

**R5 — Undeclared capabilities are absent, not throwing.** `requires` is the whole truth: `ctx.game`
is `undefined` unless `game.launch` was declared, mirroring how `app.game`'s domains work for
runtime plugins. What the picker lists and what a test can reach are the same set by construction.

**R6 — `presentation` is a declaration, not a mechanism.** A window appears because a test asked the
host for a game session. The field is what the picker badges and what warns the author a window is
coming; a `headless` test that launches one is a host error, not a silent success.

**R7 — A test run holds the run slot.** `useActiveRunMode` gains a `"test"` kind, the status bar
shows it, and the Run split button becomes Stop while a test runs. Dev Mode and Preview are inert
during a run and vice versa: they contend for the same compiled-artifact directory and the same
Stop affordance. One run at a time, per project.

**R8 — Live log to a console channel; verdict to a report tab.** Confirmed with the user. The
dialog's job ends at Start (the Build dialog made the same call). Live lines go to a new `test`
channel via `ConsoleService.registerChannel`, with the indeterminate progress bar `BuildService`
already established; the terminal verdict opens a **Test Report** editor tab carrying the findings,
whose `target` is a `SearchJumpTarget` so click-to-jump is existing machinery. Diverges from lint's
"a report is a document" only in also having a live phase — a run is an event, a lint sweep is not.

**R9 — Frozen workspace: headless yes, windowed no.** A test is a read-only observer, so a headless
one runs while frozen exactly as `lint:project` does. `game.launch` is refused while frozen, because
Preview already is (`PreviewManager.ts:143`) and a test must not be a way around that gate.

**R10 — Findings carry their own severity, unlike lint.** A lint rule defers severity to the
project's config table; a test has no such table and states its verdict separately. A finding here
is evidence for a verdict already reached, so it carries its own weight.

**R11 — Phase 1 ships one built-in test: `narraleaf-studio:project-diagnostics`.** Headless, wraps
the existing 26-rule lint engine, maps `LintReportEntry` 1:1 onto `TestFinding`. It exists so the
picker is not empty on merge and so the whole chain (register → pick → run → findings → jump) is
exercised by shipped code. It is deliberately *not* one of the two phase-2 tests.

## 3. Protocol

`src/renderer/lib/testing/types.ts` (author-facing) and `src/shared/types/gameTest.ts` (wire).
Both are written and are the contract every work item codes against — **read them first; do not
weaken them.** `TEST_PROTOCOL_VERSION = 1`.

The seam that does not exist yet, specified here so the renderer and main halves can be built in
parallel:

### IPC namespace `gameTest`

| call | direction | shape |
|---|---|---|
| `gameTest.launch` | request | `GameTestLaunchRequest → GameTestLaunchResult` |
| `gameTest.stop` | request | `{ projectPath, sessionId } → void` |
| `IPCEventType.workspaceGameTestEvent` | main → renderer push | `GameTestEventPayload` |

Pushed, not polled: the ordering between "the game logged this" and "the game then died" is
load-bearing evidence. Preload binding `gameTest.onEvent(handler)`, alongside `devMode.onConsoleLog`.

## 4. Work items

Ownership is exclusive — the file lists are the conflict boundary.

**WI-1 · main + runtime observation channel.** `src/main/app/application/managers/gameTest/**`,
`src/main/app/application/managers/window/handlers/gameTestAction.ts`, `defaultHandlers.ts`,
`src/main/preload/ipc/interface.ts`, `src/shared/types/ipcEvents.ts`, `src/shared/types/renderer.ts`,
`src/runtime/**`. Delivers: test-owned game sessions, exit classification, network blocking, and the
game-side uncaught-error + `game-end` hooks.

**WI-2 · registry, runner, built-in test.** `src/renderer/lib/testing/**`,
`src/renderer/lib/workspace/services/{services.ts,serviceRegistry.ts}`. Delivers: the registry, the
run controller, console-channel wiring, the capability handles, `project-diagnostics`.

**WI-3 · UI.** `src/renderer/apps/workspace/modules/testing/**`, `modules/actions/RunControl.tsx`,
`modules/status-bar/{useActiveRunMode.ts,entries.tsx}`, `modules/registry.ts`,
`src/shared/i18n/catalog/{en,zh}/test.ts` + both `index.ts`. Delivers: the Run ▸ Test row, the
picker dialog, the report tab, the status-bar phase. **Owns every i18n edit.**

**WI-4 · plugin surface.** `src/shared/types/plugins.ts`, `src/shared/utils/pluginManifest.ts`,
`src/renderer/plugin/index.ts`, `src/renderer/lib/plugins/pluginRuntime.ts`,
`packages/plugin-types/**`. Delivers: `contributes.tests`, validation, `app.services.tests`, the
published types.

## 5. Acceptance

Orchestrator drives the real app; subagent reports and green tests do not constitute acceptance.
Screenshots of: Run ▸ Test row · picker listing the built-in test with its headless badge · a run
streaming into the console `test` channel · the report tab's verdict and findings · the status bar
showing the test phase · a fixture plugin's test appearing in the picker alongside Studio's.

## 6. Known follow-ups (not phase 1)

- The two built-in tests (ending reachability, no-network) — phase 2.
- `NarraLeaf/Plugins` `schema/manifest.schema.json` needs `contributes.tests`; it is already missing
  five existing keys, so the sync is a pre-existing debt this card only adds to.
- `TestProjectHandle` is thin by design (`listStories`/`listScenes`). A reachability test needs the
  scene graph, which is a protocol addition with a version bump — the designated extension point.
