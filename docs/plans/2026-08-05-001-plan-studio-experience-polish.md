# Studio experience polish — download sources, cache, settings portability

Card: 2026-08-05-001 · Branch `feat/studio-preferences-and-mirrors` · Worktree `.claude/worktrees/studio-polish`

Everything here is about **Studio as an application** rather than the game it authors: where Studio
fetches official content from, what it leaves on disk, and whether a configured Studio can be reset
or carried to a second machine.

## 1. Problem

### 1.1 Half the official downloads have no mirror, and the half that does covers the wrong half

Studio reaches the network in seven places. Two are configurable.

| # | What is downloaded | From | Configurable today |
|---|---|---|---|
| 1 | Plugin registry index | `raw.githubusercontent.com/NarraLeaf/Plugins/master/index.json` | `plugins.registryUrl` |
| 2 | **Plugin release `.zip`** | the absolute URL the index carries (`github.com/.../releases/download/...`) | **no** |
| 3 | **Plugin store icons** | absolute `https` URL from the index | **no** |
| 4 | UI template index and each template file | `raw.githubusercontent.com/NarraLeaf/UI-Templates/master/` | `uiTemplates.registryUrl` (files resolve against the index directory, so one setting really does cover both) |
| 5 | Electron dist for cross-platform game builds | electron-builder's default | `build.electronMirror` |
| 6 | **electron-builder binaries** (winCodeSign, NSIS, AppImage, 7za) | `github.com/electron-userland/electron-builder-binaries/releases/download/` | **environment variable only**, never surfaced |
| 7 | **Plugin build dependencies** (`contributes.buildDependencies`) | absolute URL in the plugin manifest, digest-pinned | **no** (has a manual drop-the-file escape hatch) |

Row 2 is the one that matters. `resolveRegistryUrl` mirrors where the *catalogue* is read from, and
then `downloadPackage(entry.release.download)` follows an absolute `github.com` URL the setting never
touched (`src/main/app/application/managers/pluginRegistryClient.ts:224`). An author behind a mirror
can point Studio at a mirrored index, browse the whole store, press Install, and time out. The
feature reads as broken rather than as unreachable.

Row 6 already knows what a mirror is (`binariesMirror()`,
`src/main/buildWorker/winCodeSignCache.ts:46`) and reads two environment variables to find one, which
is not a thing a Studio user has. `GameBuildManager.ts:1675` documents the split in a comment and
stops there.

Studio has **no updater at all**: `electron-builder.yml` sets `publish: null` and nothing depends on
`electron-updater`. Meanwhile `app.autoCheckUpdates` sits in `GLOBAL_STATE_DEFAULTS` as a key nothing
reads (§1.3). There is nothing to mirror for Studio's own binary yet; that is a separate card, not
this one.

### 1.2 Nothing Studio caches can be seen or cleared

`clearCache` / `clearStorageData` have zero hits in `src/main`. There is no cache command, no size
readout, no eviction pass anywhere. What accumulates:

- `<userData>/plugin-icons/` — a cache in the true sense, bounded per plugin, cheap to refill.
- `<userData>/cache/build-deps/<sha256>/` — one SDK-sized archive plus its unpacked output per plugin
  build dependency (`src/main/buildWorker/pluginBuildDependencies.ts:61`). Never evicted.
- `%LOCALAPPDATA%/electron-builder/Cache/` — the large one: winCodeSign, NSIS, and a full Electron
  dist per (version × platform × arch) that any cross-build ever touched. Gigabytes, and Studio is
  what put them there.
- `%TEMP%/narraleaf-psd/<timestamp>/` — a fresh directory of full-canvas PNGs on **every** PSD
  import, **never deleted** (`.../handlers/psdImport.ts:52`). This is a leak, not a cache.
- Chromium's own `Cache`, `Code Cache`, `GPUCache`, `DawnGraphiteCache`, … under `userData`.
- `<userData>/logs/`.

And one that is not on disk: `global.json` grows a `ui.editor.session.project.<id>` and a
`stats.project.<id>` key per project ever opened, with **no removal path**. A real dev profile here
carries 13 session keys and 10 stat keys for projects long gone.

### 1.3 The settings store is write-only, mixed, and non-portable

`GlobalStateManager` exposes `get` / `set` / `getAllKeys` / `raw`. There are exactly three IPC
handlers: `AppGlobalStateGetHandler`, `AppGlobalStateSetHandler`, `AppGlobalStateGetAllHandler`
(`.../handlers/appAction.ts:171-198`). `PersistentState.removeItem` and `.clear()` exist
(`src/shared/utils/persistentState.ts:43`) and **are not reachable from the renderer**.
`clearAllProjectStats.ts:11` already documents living with it: "global state exposes no delete
channel", so it overwrites with empty records instead.

Consequences:

- **There is no reset.** Writing the default over a key is not the same thing, and for the keys
  deliberately absent from `GLOBAL_STATE_DEFAULTS` it is actively wrong: `ui.background*` must stay
  unset so `readBackgroundSettings` can clamp and whitelist, and `editor.slashAtAlias` must stay
  unset so `slashAtAliasDefault()` can answer per device locale. Both comments in
  `src/shared/types/state/globalState.ts` say so.
- **There is nothing to export.** One `global.json` holds preferences, recent projects, dock layout,
  per-project editor sessions, per-project statistics and the UI editor's viewport state. Measured on
  a real profile: **96 keys / 71 KB**, of which 43 are `ui.*` and only 8 of those are preferences.
  Hand-copying the file carries someone else's project list and statistics.
- **Twelve keys ship a default and are read by nothing.** Verified by grep over `src/**`, excluding
  the declaration itself: `app.showHint`, `app.notificationsEnabled`, `app.autoCheckUpdates`,
  `workspace.restoreLastWorkspace`, `workspace.autoSave`, `sync.autoBackup`,
  `sync.backupIntervalMinutes`, `sync.backupPath`, `advanced.enableTelemetry`,
  `advanced.enableDevTools`, `advanced.experimentalFeatures`, `editor.lineNumbers`,
  `editor.softWrap`. They are correctly absent from the settings UI (whose registry says "do not add
  placeholders"), but they are on every profile's disk, and the legacy `workspace.confirmOnClose` is
  still there too. Any naive export or reset would carry all of them.

## 2. Rulings

**R1 — Two kinds of network setting, because the code genuinely has two.** A *source* is a base URL
that a downstream tool composes paths onto: `electronDownload.mirror` wants `<mirror><version>/<file>`,
`ELECTRON_BUILDER_BINARIES_MIRROR` wants a different layout, a registry URL points at one document.
A *rewrite* is a prefix substitution applied to a URL **Studio did not choose** — the plugin zip, the
icon, the plugin build dependency, all of which arrive inside a document. No single knob covers both
and pretending otherwise produces a setting that silently does nothing for half its rows. The Network
panel therefore has a Sources section (four named URL fields, blank = official) and a Rewrites
section (an ordered table).

**R2 — One rewrite table, not one mirror setting per feature.** `network.downloadRewrites` is an
ordered `{ from, to, enabled }[]` under a single key, matched by URL prefix, first enabled match wins.
Reason: the set of *hosts* is small and fixed (`raw.githubusercontent.com`, `github.com`,
`objects.githubusercontent.com`) while the set of *features* keeps growing — a per-feature setting has
to be remembered again for feature number eight, and is invisibly missing until someone reports it.
One key rather than one per rule for the reason `keybindings.overrides` and `ui.statusBar.hiddenItems`
give: rule ids would contain dots.

**R3 — Rewriting is a main-process act with an https floor.** The resolver lives in
`src/shared/utils/downloadSource.ts` (pure, testable) and is called at each `fetch` site in main. The
rewritten URL must parse and must be `https:`; anything else is refused and the original is used. The
existing boundary is unchanged — a renderer still never supplies a download URL. Rewriting a plugin
zip does mean trusting the mirror to serve the plugin that was approved, but that is the same trust
the author already extends by typing a `plugins.registryUrl`, and the digest-pinned build
dependencies (row 7) are the case where a rewrite is provably safe.

**R4 — A rewrite that fires says so.** Every rewritten fetch logs `<original> -> <rewritten>` at info
into whatever channel that feature already logs to (build log, store error surface). The first
support question will be "is my mirror actually being used", and today `build.electronMirror` answers
it only for cross-builds, in one line, and only when a cross target is selected.

**R5 — Cache is an inventory, not a button.** A single Clear button deletes a list nobody can audit,
and these buckets are not comparable: plugin icons refill in seconds, an Electron dist refills in
gigabytes. Main gains a `CacheInventory` that enumerates named buckets as
`{ id, path, sizeBytes, entryCount }` and clears them individually or together. Buckets:
`plugin-icons`, `build-deps`, `electron-builder`, `chromium`, `psd-temp`, `logs`. Deliberately **not**
buckets: `backgrounds` (that is the wallpaper, not a cache), `dev-mode-saves`, `plugins`,
`authorization`, `signing`, `state`.

**R6 — The PSD temp directory is a bug to fix, not a bucket to offer.** Baked layers are read back
immediately by the asset import; the directory should be removed when the import settles and any
leftovers swept at startup. It stays in the inventory only so an author can see the sweep worked.

**R7 — Reset means deleting the key, so a delete channel is required.** New
`appGlobalStateDelete(keys: string[])` → `PersistentState.removeItem` → broadcast. The broadcast now
has to carry "this key has no value", and `SettingsApp`'s change listener currently writes
`change.value` straight into its map — both sides must resolve an absent value through the
descriptor's default rather than storing `undefined`.

**R8 — Reset and export operate on a declared preference set, never on "everything in the store".**
`global.json` is a mixed store, so the scope is: the `AppSettings` registry's keys, plus a small
shared list of preferences that have no settings row (`ui.runMode`, `ui.background*`,
`story.actionCreator.starredActionIds`). Main independently refuses to delete anything matching a
shared protected list (`app.recentProjects`, `stats.project.*`) so a renderer bug cannot erase a
project list. Workspace layout (`ui.*Sidebar*`, `ui.bottomPanel.*`, `ui.editor.session.*`,
`uiEditor.*`) is its **own** reset scope, separate from preferences, because "my panels went weird"
and "put my preferences back" are different requests.

**R9 — An exported settings file is a versioned document, not a copy of `global.json`.**
`{ formatVersion, exportedAt, studioVersion, platform, settings }`. Import type-checks every value
against the registry descriptor (enum membership, min/max, value type) — the file is user-editable
and hand-edited files are the normal case, not the exception. Keys this build does not know are
listed and skipped rather than persisted, so the store does not become a dumping ground for a newer
Studio's vocabulary. Import shows the diff (key, current, incoming) and applies on confirm through
the ordinary `set` path so every open window gets its broadcast.

**R10 — Machine-specific values are excluded from export by default.** `sync.backupPath` is a path on
one machine; `ui.backgroundImage` names a file in a cache the other machine does not have.
`versionControl.author*` and `keybindings.overrides` are wanted on a second machine but are personal,
so they are opt-in checkboxes at export time rather than silent inclusions.

**R11 — Dead keys are removed, not implemented.** The twelve unread keys plus legacy
`workspace.confirmOnClose` come out of `GlobalStateType` / `GLOBAL_STATE_DEFAULTS`, and a one-time
startup sweep deletes them from disk. A default that nothing honors makes `raw()` lie about what
Studio does; when an updater or a telemetry switch actually ships it will declare its own key.
(Verification step before deleting: grep for dynamically composed keys, and confirm no plugin-facing
API exposes global state by arbitrary string.)

## 3. Work items

### M1 — Download sources (the core of the ask)

- `src/shared/utils/downloadSource.ts` — `rewriteDownloadUrl(url, rules)`, prefix match, https floor,
  first-enabled-wins. Unit tests: no rules, non-matching, ordering, protocol downgrade refused,
  malformed `to`.
- `src/shared/types/state/globalState.ts` — `network.downloadRewrites`, and move
  `build.electronMirror`, `plugins.registryUrl`, `uiTemplates.registryUrl` into the new category.
  New `build.electronBuilderBinariesMirror` (row 6), read by `winCodeSignCache.binariesMirror()`
  ahead of the two environment variables it already honors.
- Call sites: `pluginRegistryClient` (index, package, icon), `uiTemplateRegistryClient` (index,
  file), `pluginBuildDependencies` (declared URL), `winCodeSignCache`.
  The build worker is electron-free, so rules are passed in the worker config exactly as
  `electronMirror` already is (`buildWorker/protocol.ts`).
- Settings: new `network` category; `SettingPanelId` gains `"downloadSources"`; panel under
  `src/renderer/apps/settings/panels/`, modeled on `KeybindingsPanel` (the existing precedent for a
  panel that owns its own storage).
- Per-row "Test" button: `HEAD`/ranged `GET` with the 5 s budget `pluginBuildDependencies` already
  uses for its reachability probe. A mirror that is typed but wrong is the common case and must be
  discoverable without starting a build.

### M2 — Cache inventory

- `src/main/app/application/managers/storage/cacheInventory.ts` — bucket table, `measure()`,
  `clear(ids)`. Electron-builder cache root resolution mirrors `winCodeSignCache.builderCacheRoot()`
  (`ELECTRON_BUILDER_CACHE`, then per-platform default). Chromium via `session.clearCache()` and
  `clearCodeCaches()`.
- IPC `appCacheInventory` / `appCacheClear`.
- Fix the PSD temp leak at its source (R6) plus a startup sweep of `%TEMP%/narraleaf-psd`.
- Settings panel `"cacheInventory"`: one row per bucket with size, a per-row clear, a clear-all.
  Sizes are computed on demand (walking `electron-builder/Cache` is not free) with the panel showing
  a measuring state.

### M3 — Reset

- IPC `appGlobalStateDelete` + protected-key list in `@shared/constants/settingsScopes.ts`.
- Broadcast/absent-value handling in `SettingsApp` and `GlobalSettingsService` (R7).
- Per-row reset: hover-revealed, shown only when the stored value differs from the resolved default
  (per `ui-style-constraints`: hover-reveal over a permanent control).
- Category reset, "Reset all preferences", and the separate "Reset workspace layout" (R8).
- The per-project residue from §1.2 gets its own list: entries labelled with the project name from
  recents where known, cleared by explicit selection. Studio does not guess that a project id it does
  not recognize is dead — an id absent from recents is not an id whose project was deleted.

### M4 — Import / export

- `src/shared/utils/settingsDocument.ts` — compose, parse, validate against descriptors (R9).
- Main: `appExportSettings` / `appImportSettings`, both using `dialog.show{Save,Open}Dialog` exactly
  as `AppExportDiagnosticsHandler` does (`.../handlers/appAction.ts:389`) — it is the established
  precedent for "write a file the user picked, no grant involved".
- Renderer: export Action row with the three opt-in checkboxes (R10); import Action row opening a
  diff modal before anything is written.

### M5 — Dead keys (R11)

Remove twelve keys plus `workspace.confirmOnClose`; one-time sweep on startup. Small, but it must
land **before** M4 or the first exported document carries thirteen meaningless keys forever.

### M6 — Docs

`project/docs/settings.md` gains the reset/export/scope model; `docs/design-system.md` is untouched.
A short "Network sources" section belongs in the user-facing docs site, out of this repo.

## 4. Decisions taken

1. **No preset mirrors.** Official plus a user-defined table, with a per-row reachability test. A
   third-party proxy Studio shipped would eventually die and read as Studio being broken; the table
   plus the test button is what lets an author configure and verify their own without that risk.
2. **All of M1–M5 this round.** Order: M5 first (it is small and M4 must not inherit dead keys), then
   M1, M2, M3, M4.
3. **`versionControl.author*` exports opt-in**, per R10.

## 5. Acceptance

- `node node_modules/typescript/bin/tsc --project src/{shared,main,renderer,runtime}/tsconfig.json --noEmit`
  (absolute path, `--noEmit` mandatory — see `isolated-worktree-testing`).
- New unit tests: `downloadSource`, `settingsDocument`, `cacheInventory` bucket resolution.
- i18n: every new key in **both** `en` and `zh` catalogs; the parity test is what enforces it.
- `node scripts/style-ratchet.mjs` before commit; the six debt counters may only fall.
- Real-app verification, driven by the orchestrator personally (`orchestrator-visual-acceptance`):
  point a rewrite at a local HTTP server, watch the store install through it; clear a bucket and see
  the size drop; export, reset all, import, confirm the profile came back.

## 6. Out of scope

Studio self-update (there is no updater to mirror yet), telemetry, cloud settings sync, a NarraLeaf
mirror service, and any change to the `NarraLeaf/Plugins` registry schema. The relative-URL fix that
would make row 2 mirrorable without a rewrite table belongs to that repo and is a separate card.
