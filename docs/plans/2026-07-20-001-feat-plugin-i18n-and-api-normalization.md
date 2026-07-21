---
title: "feat: Plugin i18n (read + language packs) and Plugin API normalization"
type: feat
status: in-progress
date: 2026-07-20
---

# feat: Plugin i18n (read + language packs) and Plugin API normalization

## Overview

The plugin system (manifest v2, dual studio/runtime targets — see
`2026-07-11-001-feat-plugin-dual-target-architecture.md`) exposes editor
extension points but **no i18n at all**. A user running Studio in Chinese still
sees built-in plugin node names ("Add Gallery Item", "Quick Save") and manifest
strings in English, because plugins have no way to read the editor language or
ship translations.

This plan adds two i18n capabilities and normalizes the whole plugin surface
before it is published + documented:

1. **Read side (Phase 1):** a plugin can localize *its own* strings against the
   editor's current language and react to live language switches.
2. **Write side (Phase 2):** a plugin can **translate Studio itself** — ship a
   new locale (a "Japanese language pack") or fill gaps in an existing locale —
   and have it appear in the Settings language picker and apply app-wide.
3. **Normalization (Phase 3):** one coherent convention across every exposed
   studio + runtime interface (disposer semantics, `registerMany`, id
   namespacing, error shapes), applied before the `narraleaf-studio` types
   package is published and the docs are written.
4. **Types + docs (Phases 4–5):** regenerate the `narraleaf-studio` types
   package and author the plugin docs on narraleaf.com in en + zh.

**No V1 compat / not-yet-published:** the `narraleaf-studio` package is at
`0.1.0` and unpublished; the plugin API is undocumented publicly. Breaking
changes are acceptable and are listed exhaustively below.

## Two locale systems — do not conflate

Studio has two unrelated locale systems. **Only the first is in scope.**

| | **Studio UI i18n** (in scope) | **Game/content localization** (out of scope) |
| --- | --- | --- |
| Code | `src/shared/i18n/*`, `src/renderer/lib/i18n/*` | `LocalizationService`, `VoiceService`, `bundleAssembler`, `@shared/types/localization` |
| What | The editor's own UI language (menus, panels, settings) | The player-facing translation of a *project's* narrative content |
| Locale set | closed `Locale = "en" | "zh"` union | loose per-project `LocaleCode`, `sourceLocale`, `addLocale()` |
| Plugin story | **this plan** | untouched |

`LocalizationService.addLocale` / `VoiceService.addLocale` are the *game* system;
they are not consumers of `SUPPORTED_LOCALES`/`CATALOGS`/`Locale` and are not
touched here.

## Verified starting state (2026-07-20)

Studio UI i18n core — `src/shared/i18n/`:
- `locales.ts` — `SUPPORTED_LOCALES = ["en","zh"] as const`; `Locale =
  (typeof SUPPORTED_LOCALES)[number]` (closed union); `LOCALE_META:
  Record<Locale, LocaleMeta>`; `isLocale`/`normalizeLocale` (the latter
  **silently rewrites any unknown code to `DEFAULT_LOCALE`** — hard blocker for
  a dynamic `"ja"`); `SOURCE_LOCALE`/`FALLBACK_LOCALE`/`DEFAULT_LOCALE = "en"`.
- `translator.ts` — module-level `flatCache: Map<Locale, FlatMessages>` (**never
  invalidated**); `getFlat(locale)` flattens `CATALOGS[locale]`; `createTranslator`
  reads `LOCALE_META[locale].intl` by **direct index (throws if missing)**.
- `catalog/index.ts` — `CATALOGS: Record<Locale, LocaleMessages> = { en, zh }`.
- `catalog/types.ts` — `TranslationKey` is a **closed string-literal union**
  flattened from the `en` catalog; `t()` tolerates unknown keys at runtime
  (warns once, returns the key).

Renderer wrapper — `src/renderer/lib/i18n/`:
- `store.ts` — per-window singleton; `setLocale(next)` **early-returns if
  `next === currentLocale`** (blocks a "messages changed, same locale"
  re-notify), rebuilds the translator, writes `<html lang/dir>` from
  `LOCALE_META[locale]` (direct index), notifies listeners.
- `useTranslation.ts` — `useSyncExternalStore`; `setLocale` persists
  `app.language` global state.
- `bootstrap.ts` — `initI18n()` reads persisted `app.language` (through
  `normalizeLocale`), applies it before first paint, and subscribes to the
  main-process global-state broadcast so every window re-localizes.

Main process — `src/main/app/application/i18n.ts` `getMainTranslator(app)` builds
a fresh translator from persisted `app.language`; used by
`menuManager.ts:230` to localize the **native menu bar** (macOS).

Settings picker — `src/renderer/lib/settings/appSettings.ts:96-108` computes the
`app.language` enum `options`/`optionLabels` **once at module import** from
`SUPPORTED_LOCALES` + `LOCALE_META`; `SettingsApp.tsx`/`SettingsExplorer.tsx` are
pass-through.

**Two decisive facts** established by investigation:
1. **The Settings window does not load plugins.** `loadWorkspacePlugins` /
   `useWorkspacePlugins` run only in the workspace window (`WorkSpaceApp.tsx`).
   So a locale registered imperatively from a plugin's studio entry lives only in
   that workspace renderer and is invisible to the Settings picker.
2. **The main process localizes the native menu.** A plugin locale must reach the
   main process to localize the macOS menu bar.

Plugin host lifecycle — `src/renderer/lib/plugins/pluginRuntime.ts`
`createPluginApp` builds `app.services`, with a per-plugin `disposables: Array<()
=> void>` bag and `track(disposer)` helper drained LIFO by `dispose()` on unload.
`ui.keybindings.register`, `story.actions.register`,
`blueprintNodes.registerDynamicSelectOptionsSource` already return a
`PluginCleanup` and `track()` it. Runtime host —
`loadRuntimePlugins.ts` `createRuntimePluginApp` — has **no cleanup lifecycle**
(game process, load-once).

## Consequence of fact #1 for Phase 2 (architecture driver)

The task requires plugin locales to **appear in the Settings picker and disappear
when the plugin is disabled**. The Settings window does not load plugins, and the
main process must also see the locale (native menu). Therefore a *renderer-only,
imperatively-registered* locale cannot meet the requirement.

**Phase 2 must aggregate locale contributions in the main process** (which owns
`PluginManager`, reads every manifest, and owns `app.language` global state) and
broadcast them to all renderers + feed its own translators. This is not a
preference — it is forced by the requirement + fact #1. It also cleanly splits
the two capabilities:

- **Phase 1 (localize the plugin's own strings):** imperative, window-local,
  in-memory JS bundles the plugin ships. No main-process involvement.
- **Phase 2 (translate Studio itself):** declarative manifest + static JSON
  catalog files, aggregated in main, broadcast to all windows. Static data.

---

## Phase 1 — Expose i18n to plugins (read side)

### Studio surface: `app.services.i18n`

Add to `PluginServices` (`src/renderer/plugin/index.ts`) and implement in
`createPluginApp`, tracking the subscription disposer via the existing `track()`
bag so it is reclaimed on unload even if setup throws:

```ts
export type PluginI18n = {
    /** The editor's active locale code (e.g. "en", "zh", or a plugin locale). */
    readonly locale: LocaleCode;
    /** Subscribe to live editor-language changes. Returns a disposer (tracked). */
    onLocaleChange(listener: (locale: LocaleCode) => void): PluginCleanup;
    /** Locale-aware formatters bound to the editor's active locale. */
    formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
    formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
    formatList(items: string[], options?: Intl.ListFormatOptions): string;
    /**
     * Build a translator over the PLUGIN's own message tables (not Studio's
     * catalog). `messages` maps locale code -> (dotted key -> string). The
     * translator follows the editor's active locale, falling back to
     * `fallbackLocale` (default the plugin's first table / "en").
     */
    createTranslator(bundle: PluginMessageBundle): PluginTranslator;
};

export type PluginMessageBundle = {
    messages: Record<string, Record<string, string>>; // locale -> key -> string
    fallbackLocale?: string;
};

export type PluginTranslator = {
    readonly locale: LocaleCode;
    t(key: string, params?: Record<string, string | number>): string;
};
```

Implementation notes:
- `locale`/`onLocaleChange`/`format*` read/subscribe the renderer `i18nStore`.
  `onLocaleChange` wraps `i18nStore.subscribe` and is `track()`ed.
- `createTranslator` returns a live object whose `.locale` reflects the store and
  whose `t()` resolves `messages[activeLocale]` → `messages[fallback]` → key,
  with `{placeholder}` interpolation. It does **not** touch Studio's catalog or
  `flatCache`. Plugins that want their panel titles to re-localize subscribe via
  `onLocaleChange` and re-render (their React components already re-render on
  their own state; we document the `useSyncExternalStore` pattern in the guide).

`LocaleCode = string` (new; see Phase 2) is the public locale type on the plugin
surface, so a plugin sees a plugin-provided locale like `"ja"` too.

### Runtime surface: deliberately NOT added

The runtime entry runs in the **game** process (Dev Mode window, Preview,
**Production**). Decision: **do not expose Studio's editor i18n to the runtime
entry.** Rationale, recorded per the task:
1. In Production there is no editor and no `app.language`; a Studio-locale
   accessor would be undefined/meaningless there — the runtime API must be
   portable across all three game environments.
2. The game already has its **own** player-facing localization system
   (`nls.locale` persistent key + `GameLocalizationBundle` + NLR DynamicWord —
   see `2026-07-09-001-feat-game-localization.md`). That, not the editor's
   language, is the correct locale for game-facing plugin strings.
3. A runtime plugin that needs the *player's* language should read it through the
   game localization system's own (future) accessor, keeping "editor language"
   and "player language" from leaking into each other.

So `RuntimePluginApp` gains no i18n. This is documented in the API reference as a
conscious boundary, with a pointer to the game localization system.

---

## Phase 2 — Studio language packs (write side)

### Model: declarative manifest + static JSON + main-process aggregation

A plugin ships one JSON catalog per locale it provides and declares them in the
manifest. Main aggregates all enabled plugins' catalogs, feeds its own
translators, and broadcasts to every renderer.

**Manifest — new `contributes.locales`** (array of locale descriptor objects —
deliberately *not* the "array of id-prefixed strings" shape the other contributes
use, because a locale code like `"ja"` is not plugin-namespaced):

```jsonc
{
  "contributes": {
    "locales": [
      {
        "code": "ja",              // required; BCP-47-ish, [a-z]{2,3}(-[A-Za-z0-9]+)*
        "nativeName": "日本語",     // required for a NEW locale (picker endonym)
        "englishName": "Japanese", // optional
        "intl": "ja-JP",           // optional; defaults to code
        "dir": "ltr",              // optional; "ltr" | "rtl"; default "ltr"
        "messages": "locales/ja.json"  // required; safe-relative JSON path
      },
      { "code": "zh", "messages": "locales/zh-extra.json" } // fill built-in zh gaps
    ]
  }
}
```

Catalog JSON is a flat `{ "<studio.translation.key>": "<translation>" }` map (the
same dotted keys `TranslationKey` produces). Validated on load: object of
string→string.

**Registration channel decision: declarative-only, no runtime `registerLocale`.**
Rationale: the picker/native-menu requirement forces main-process aggregation of
*static* data; an imperative renderer call cannot satisfy it (fact #1). A second,
runtime registration channel would be a redundant path that could not reach the
picker, so it is not added. (Phase 1's `createTranslator` covers the plugin's own
strings; Phase 2's manifest covers translating Studio.) A plugin does **not** need
a studio *entry* to ship a language pack — a manifest with only
`contributes.locales` is valid (new allowance; see below).

**Forward-compat break (sequenced):** the manifest validator rejects unknown
`contributes` keys today, so a `contributes.locales` plugin fails to install on
older Studio builds, and the registry CI rejects it until its port is updated. We
update `src/shared/utils/pluginManifest.ts` **and** the registry port
`Plugins/scripts/lib/plugins.mjs` (+ `toIndexEntry`) in lockstep. Documented as
"language packs require Studio ≥ <this release>".

### i18n core changes: a runtime locale registry overlay

New `src/shared/i18n/registry.ts` — a process-wide overlay merged *over* the
static baseline:

```ts
type LocaleOverlayEntry = { meta?: Partial<LocaleMeta>; messages: Map<string,string> };
// code -> overlay; plus a version counter + subscribe() for invalidation.
```

- `setLocaleContributions(list)` replaces the overlay from an aggregated list
  (main and each renderer call this), bumps the version, invalidates the affected
  `flatCache` entries, and notifies subscribers.
- Keeps the static `SUPPORTED_LOCALES`/`LOCALE_META`/`CATALOGS` as the **built-in
  baseline**; the overlay only adds/extends.

Refactors driven off the overlay:
- `locales.ts` — add `LocaleCode = string`; `getRegisteredLocales(): LocaleCode[]`
  (baseline ∪ overlay), `getLocaleMeta(code): LocaleMeta` (baseline → overlay →
  safe default `{ nativeName: code, englishName: code, intl: code, dir: "ltr" }`).
  `isLocale`/`normalizeLocale` consult `getRegisteredLocales()` so a registered
  `"ja"` **survives** persist/restore/broadcast instead of collapsing to `en`.
  Keep `Locale` (the closed union) for typed baseline authoring only.
- `translator.ts` — `getFlat(code)` merges baseline `CATALOGS[code]` (if built-in)
  with the overlay messages for `code`; `flatCache` keyed by `LocaleCode` and
  cleared on overlay version change; replace direct `LOCALE_META[locale]` with
  `getLocaleMeta(code)`.
- `store.ts` — subscribe to the registry; add a `refresh()` path that rebuilds the
  translator + notifies **even when the locale value is unchanged** (needed when a
  plugin adds messages to the *current* locale); on overlay change, re-resolve the
  active locale and fall back if its provider vanished; guard document-locale via
  `getLocaleMeta`.

### Aggregation + propagation

- `PluginManager.listLocaleContributions()` (main) — for each **enabled** plugin
  with `contributes.locales`, read each `messages` JSON from `record.installPath`
  (reuse `isSafeRelativeEntry` path safety), parse + validate, return
  `{ pluginId, code, meta, messages }[]`. Malformed files are skipped with a
  logged error (never crash the app).
- New IPC `plugins.getLocaleContributions()` (any window may call) + a
  `pluginLocalesChanged` broadcast event fired when the enabled set changes
  (install/enable/disable/uninstall).
- Main startup + on change: call `setLocaleContributions(...)` into the shared
  registry so `getMainTranslator` (native menu) sees the overlay.
- Each renderer `bootstrap.initI18n`: fetch contributions and
  `setLocaleContributions(...)` **before** resolving persisted `app.language`
  (so a persisted `"ja"` resolves), and subscribe to `pluginLocalesChanged` to
  re-aggregate + `store.refresh()`.
- Settings picker: `appSettings.ts` language `options`/`optionLabels` move from a
  frozen module-import constant to being computed at describe time from
  `getRegisteredLocales()` + `getLocaleMeta`, and the settings view re-renders on
  registry change. Persisted selection survives a missing provider (degrades to
  fallback at resolve time, value untouched).

### Collision policy (explicit + observable)

Merge order = plugin load order (deterministic from the enabled list). Rules,
enforced in the overlay merge, every violation logged to console **and** the host
plugin log (never silent):

1. **New locale** (code not a built-in baseline locale): the providing plugins own
   it. For a given `(code, key)`, last write wins; overwriting another plugin's
   value logs a warning naming both plugins + the key.
2. **Extending a built-in locale** (`en`/`zh`): a plugin may **fill** any key the
   built-in catalog does not itself provide for that locale — free, no warning.
3. **Overriding a built-in-satisfied key is disallowed.** If a plugin supplies a
   key the built-in catalog already provides for that locale, the **built-in value
   wins** and a warning is logged. Retranslating shipped strings is a fork, not a
   plugin concern; "fill gaps" is the blessed path. (Chosen over last-wins because
   the task flags silent override of core strings as the danger; this makes core
   strings immutable-by-plugins and observable.)
4. The **source locale `en`** is additionally the fallback + key-space source of
   truth; rule 3 already protects every `en` key a plugin might target.

### Lifecycle

- flatCache invalidation + store re-notify are wired through the registry version
  (above), so mounted UI re-localizes when a pack is added/removed.
- Disabling/uninstalling the providing plugin drops its overlay entries on the
  next aggregation; if the active locale was provided by it, the store re-resolves
  and falls back to `DEFAULT_LOCALE`. The persisted `app.language` value is left
  intact so re-installing restores the choice.

### Known limitation (documented)

Because aggregation is static JSON, a language pack cannot localize strings that
are composed dynamically outside the catalog. All catalog-keyed UI (renderer +
native menu) is covered. This is acceptable and noted in the docs.

---

## Phase 3 — Normalize the exposed studio + runtime surfaces

### One convention

**Registrations vs. imperative operations.**
- A **registration** adds a keyed contribution that lives until removed. Every
  `register(x)` returns a `PluginCleanup` disposer that removes exactly that
  contribution; every `registerMany(xs)` returns one disposer removing all of
  them. The host additionally `track()`s each so unload reclaims everything even
  if the returned disposer is never called; disposers are idempotent.
- **Imperative operations** (`editors.open/close`, `notifications.*`,
  `blueprintNodes.notifyDynamicSelectOptionsChanged`, all `format*`) return their
  natural value (usually `void`), not a disposer.
- **Ids/types are namespaced.** Every registration id/type must start with
  `${pluginId}.`, enforced centrally by one helper with a uniform error:
  `[plugin:<id>] <kind> id "<x>" must be prefixed with "<id>."`.
- All registration calls are **synchronous** (they are today); no Promise-returning
  registrations.

### Studio surface changes (`PluginServices`)

| Sub-service | Before | After |
| --- | --- | --- |
| `ui.panels` | `register(): void` + `unregister(id)` | `register(): PluginCleanup`, add `registerMany(): PluginCleanup`; **remove `unregister`** |
| `ui.actions` | `register/unregister` + `registerGroup/unregisterGroup`, all void | `register/registerMany`, `registerGroup` return `PluginCleanup`; **remove `unregister`/`unregisterGroup`** |
| `ui.editors` | `open/close` | unchanged (imperative) |
| `ui.keybindings` | `register/registerMany → PluginCleanup` | unchanged (already the convention) |
| `ui.notifications` | `info/success/warning/error` | unchanged (imperative) |
| `widgets` | `register/registerMany → void` + `get/list/has` | `register/registerMany → PluginCleanup`; `get/list/has` unchanged |
| `story.actions` | `register → PluginCleanup` | unchanged; add `registerMany` |
| `blueprintNodes` | `register/registerMany → void` (untracked), `registerDynamicSelectOptionsSource → PluginCleanup`, `notify...` | **unchanged** (`register/registerMany` stay `void`; documented exception); others unchanged |
| `i18n` | — | new (Phase 1) |

**Blueprint nodes exception, made explicit.** `register`/`registerMany` **stay
`void`** — the one deliberate divergence from the disposer convention. Node defs
are session-persistent: `BlueprintNodeCatalogService` has no `unregister`
(removing a live def would orphan nodes in open/saved documents), and ownership +
`replaceExisting` govern conflicts. Returning a `PluginCleanup` would be
dishonest (there is nothing to dispose), so the surface documents them as
session-persistent void registrations instead.

Central namespacing: introduce `assertOwnedId(pluginId, id, kind)` in
`pluginRuntime.ts` and apply to panels, actions, action groups, keybindings,
widgets (already via `contributes`), blueprint nodes (already via `contributes`),
and story actions (already ad hoc) — unifying the error string.

### Runtime surface (`RuntimePluginApp.game`)

- `blueprintNodes.register/registerMany`, `widgets.register/registerMany`:
  **stay `void`.** The game process has no unload lifecycle, so a disposer would
  be a lie. This asymmetry (studio returns disposers, runtime does not) is
  intentional and documented as "runtime registrations are process-lifetime".
- `log(level, message)` unchanged.
- Apply the same `${pluginId}.` namespacing error string as studio for
  consistency (the checks already exist; unify the message).

### Breaking changes (exhaustive)

1. `ui.panels.unregister(id)` **removed** → use the disposer from `register`.
2. `ui.actions.unregister(id)` and `ui.actions.unregisterGroup(id)` **removed** →
   use the disposers.
3. `ui.panels.register`, `ui.actions.register`, `ui.actions.registerGroup`,
   `widgets.register`, `widgets.registerMany` now **return `PluginCleanup`** (was
   `void`) — source-compatible (return value was previously ignored), but a type
   change. New `registerMany` on `ui.panels`, `ui.actions`, `story.actions`.
   `blueprintNodes.register/registerMany` stay `void` (documented exception).
4. New required-ish `nativeName` on `contributes.locales` new-locale entries;
   new manifest `contributes.locales` key (older Studio rejects it).
5. `Locale` remains the closed built-in union; public plugin-facing locale type is
   now `LocaleCode = string`.

Built-in plugins updated: `gallery/main.tsx` cleanup switches from
`ui.panels.unregister(PANEL_ID)` to the disposer returned by `register`. Registry
`template/` updated if it touches any removed method (it uses
`register`/`registerMany` return-agnostically today — verify).

---

## Phase 4 — Regenerate the types package

- Run `yarn build:plugin-types` (reads `src/renderer/plugin/index.ts` +
  `runtimePluginApi.ts`; bundles both through the single `_api` module; runs the
  `BlueprintNodeDef` satisfies `RuntimeBlueprintNodeDef` probe). Confirm the probe
  still passes with the new i18n + normalized surfaces.
- Bump `packages/plugin-types/package.json` `0.1.0 → 0.2.0`. Do **not** publish.
- Optionally export `TranslationKey` + a `StudioLocaleCatalog` alias so language-
  pack authors get key autocomplete (only if it survives the single-bundle probe;
  otherwise skip and document keys in prose).
- Consumer check: `npm pack` in `packages/plugin-types`, install the tarball into
  `Plugins/template`, delete any leftover hand-written `.d.ts`, run
  `yarn typecheck` there (green).

## Phase 5 — Documentation on narraleaf.com

Expand `content/docs/studio/plugin/` (currently 4 stub pages) into three doc sets,
each en + zh, appended to `meta.json` + `meta.zh.json`:

1. **How to make a plugin** — zero → installed plugin. Template, manifest field by
   field, the two entries, a shared blueprint node, `inspectorParams`/`ctx.params`,
   a panel via the `ui` kit, localizing the plugin's own strings via
   `app.services.i18n`, shipping a Studio language pack via `contributes.locales`,
   building, packaging. Heavy on copy-pasteable examples.
2. **Interface / API reference** — the normalized studio + runtime surfaces + the
   i18n APIs; per interface: what/when/example/gotchas (host modules external in
   the bundler; a blueprint node needs BOTH entries in a shipped build; plugins
   can't read data input pins yet; runtime has no i18n and why).
3. **How to install a plugin** — end-user flow: release zip → unzip → Launcher →
   Plugins → Install from folder; permission prompt; not sandboxed;
   enable/disable/uninstall; where errors show.

Conventions (verified): `slug.en.mdx` + `slug.zh.mdx` pairs; `pages` are bare
slugs in both meta files; global MDX components (`Steps`/`Step`, `Callout`,
`Tabs`/`Tab`, `Cards`/`Card`, `Files`) with no imports (blank-line rule inside
`Step`); code fences language-tag only; internal links `/docs/...` (auto-localized).
Adapt (do not copy) `Plugins/docs/authoring.md` + `.zh-CN.md` from branch
`feat/use-types-package`; reduce those repo docs to a pointer afterward. Tone:
plain, direct, example-first, no AI filler (see task brief).

## Verification

- **NarraLeaf-Studio:** `yarn lint` green (all 5 tsc projects incl.
  `src/builtin-plugins`); i18n merge/override/invalidation tests pass
  (new, mirroring `translator.test.ts`); `yarn build:plugin-types` regenerates +
  self-verifies. The ~8 known win32 vitest failures are pre-existing and unrelated
  (see memory `windows-test-baseline`) — confirm same set.
- **narraleaf.com:** `yarn types:check` + `yarn build` pass; en + zh routes render.
- **Plugins/template:** typechecks against the freshly packed `0.2.0` tarball;
  `plugins.mjs` port accepts the new `contributes.locales`.
- Feature branch per repo; no merge to master/develop; nothing published.

## Key decisions recorded

1. **Runtime gets no Studio i18n** — game process is editor-agnostic and has its
   own player-facing localization; exposing editor locale there is a category
   error. (Phase 1)
2. **Language packs are declarative + main-aggregated**, not an imperative runtime
   call — forced by "must show in the Settings picker" + "Settings window doesn't
   load plugins" + "native menu is main-process". (Phase 2)
3. **Overriding built-in-satisfied keys is disallowed** (fill-only), with visible
   warnings; new locales and gap-fills are free. (Phase 2)
4. **`Locale` stays a closed union for authoring; `LocaleCode = string` is the
   dynamic public type.** Overlay registry merges over the static baseline; the
   never-invalidated `flatCache` gains version-based invalidation. (Phase 2)
5. **One registration convention: disposer-returning `register`/`registerMany`,
   id namespacing, imperative ops return void.** Blueprint-node defs are the one
   documented session-persistent exception; runtime registrations stay void
   (no lifecycle). (Phase 3)
