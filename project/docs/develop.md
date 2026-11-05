# Development

## Local workflow

Read `studio.md` to locate a feature's owning module and its contract document. The root
`package.json` defines the build and development commands. `project/app/dev-electron.js` describes
the development launcher flags in its file header; tag windows for the task that owns them.

Use `project/app/blueprint.js`, `ui.js` and `story.js` to query or change authoring data. Their
adjacent Markdown files describe the text formats and the show/check/apply cycle. Temporary
`.bp`, `.ui` and `.story` files live in `.ignored/` when the filename has no directory.

## Verification

`node scripts/verify.mjs` runs the checks and then the complete Vitest suite. Its `--checks` and
`--tests` flags select one half. CI uses the same check entry and shards Vitest separately.

Use the checkout's `node` scripts from a worktree and reuse the primary checkout's dependencies.
Before installing dependencies, check whether a development session is using them. A running
bundler or Electron process may still hold files that an installation replaces.

Changes under `src/renderer/lib/ui-editor/` also require the runtime bundle check. The bundler's
import plugin enforces which Studio modules a game may use. Typechecking alone covers a wider
source tree and therefore answers a different question.

The verification script retries failed test files in isolation and reports cases that fail only
under full-suite load. Platform-specific behaviour and tool-gated oracles require the matching
host and installed tools; the result reports what was skipped.

## Entry points

| Work | Contract or entry |
| --- | --- |
| Workspace lifecycle and services | `studio.md`, `workspace-ui.md` |
| Story editing and compilation | `story.md` |
| Surfaces, widget modules and blueprints | `ui-editor.md`, `ui-editor/blueprint.md` |
| Dev Mode and shared game runtime | `dev-mode.md`, `runtime-api.md` |
| Preferences and project settings | `settings.md` |
| Plugin authoring and permissions | `plugin.md`, `studio-api.md`, `create-plugin.md` |
| Headless project checks and builds | `../../docs/command-line-checks.md`, `../../docs/command-line-builds.md` |
| Interface styling | `../../docs/design-system.md` |
| Semantic version history | `../../docs/version-control.md` |

## Widget composition

Built-in widget declarations are exported from
`src/renderer/lib/ui-editor/widget-modules/builtin/declarations.ts`. They own insertion defaults,
structural parts, capabilities and names. Each editor module attaches its renderer, inspector and
tools to that same declaration with `defineWidgetModule`.

Workspace startup calls `registerBuiltinWidgetModules.ts`. Catalogue queries use declarations
directly and add any plugin declarations from the registry. A plugin's declaration validation is
shared by its command-line loader and workspace registration.

## Generated content

The script declaration generator and plugin type bundler derive public declarations from the
implementation. Their checks run through `verify.mjs`. Both plugin entry surfaces share one
bundled declaration source so shared nominal types keep their identity.

The English starter project is the source for the Chinese and Japanese variants. After changing
it, check missing translation entries with `scripts/gen-skeleton-locale.mjs --check`, fill the
locale tables and run the generator. Include the three resulting templates in the change.

## Feature candidates

These candidates await prioritisation and a scoped design. Their entries describe the remaining
workflow; the implementation named alongside each is the starting point for assessing it.

- [ ] Pin recent projects. `ProjectsTab.tsx` already searches by name and path; pinning would keep selected projects above the recent list.
- [ ] Save and switch named workspace layouts. `WorkspaceLayout.tsx` and `workspaceEditorSession.ts` restore the current layout; presets would retain several author-selected arrangements.
- [ ] Guided exercises and browsable example projects. `LearningTab.tsx` currently presents help topics and ecosystem links; exercises would work through a sample project.
- [ ] A personal library of reusable interface and blueprint fragments. The UI template store and `BlueprintTemplateLibrary.tsx` provide curated templates; a personal library would save and catalogue the author's own fragments for reuse across projects.
- [ ] Guided batch repair of missing asset files. `replaceAssetContentFlow.ts` replaces one asset while preserving its references; batch repair would match several missing files and preview the replacements before applying them.
- [ ] A visual asset dependency graph. `ReferenceService.ts` and `AssetReferencesSection.tsx` expose reference lists; a graph would connect those uses for navigation across related content.
- [ ] Named build configurations. `buildDialogState.ts` and `BuildService.ts` retain one build selection and an in-session draft; named configurations would switch between saved target, format and output selections.
- [ ] Distribution helpers for itch.io and Steam. The build pipeline produces distributable artifacts; platform helpers would prepare storefront metadata or deliver those artifacts through a platform-specific flow.
- [ ] Shareable review findings and QA checklists. `TestReportTab.tsx` displays findings in Studio, and `exportLogArchive.ts` exports diagnostic logs; structured review export would carry findings and checklists to an external review process.
