# Internationalization (i18n)

Process-agnostic i18n core for NarraLeaf Studio. Powers every renderer app
(React) and the main process (native menu, dialogs, notifications).

Zero runtime dependencies. Type-safe keys derived from the English catalog.

## Layout

```
src/shared/i18n/
  locales.ts          Locale registry: SUPPORTED_LOCALES, LOCALE_META, normalizeLocale()
  translator.ts       createTranslator(locale) -> { t, tn, has, formatNumber/Date/List }
  catalog/
    en.ts             Source of truth. Every key lives here (`as const`).
    zh.ts / ja.ts     Other locales (satisfies LocaleMessages — may be partial).
    types.ts          Messages / TranslationKey / PluralKey / LocaleMessages
    index.ts          CATALOGS registry
  index.ts            Barrel — import from "@shared/i18n"

src/renderer/lib/i18n/   React bindings (renderer only)
  store.ts            External store (locale + translator) + <html lang/dir>
  bootstrap.ts        initI18n(): load saved language, subscribe to live changes
  useTranslation.ts   useTranslation() hook
  index.ts            Barrel — import from "@/lib/i18n"

src/main/app/application/i18n.ts   getMainTranslator(app) for main-process text
```

## Using it in a component

```tsx
import { useTranslation } from "@/lib/i18n";

function Save() {
    const { t, tn, locale, setLocale, formatDate } = useTranslation();
    return (
        <>
            <button>{t("common.save")}</button>
            <span>{tn("launcher.recentCount", projects.length)}</span>
            <time>{formatDate(Date.now(), { dateStyle: "medium" })}</time>
        </>
    );
}
```

- `t("a.b.c", { name })` — translate + interpolate `{name}` placeholders. The key
  is checked at compile time; a typo is a type error.
- `tn("a.b", count, params)` — plural. The catalog provides `a.b.one` / `a.b.other`
  (add `.few` / `.many` / `.zero` where a locale needs them); the correct form is
  picked via `Intl.PluralRules`. `count` is available as `{count}`.
- `formatNumber / formatDate / formatList` — locale-aware `Intl.*` formatting.
- `setLocale(code)` — persists to global state; the main process broadcasts, so
  every open window re-renders instantly (no reload).

## Adding / changing strings

1. Add the key to `catalog/en.ts` (this defines the type — do it first).
2. Translate it in the other locales. They're typed `satisfies LocaleMessages`,
   so a typo or wrong shape fails the build; a *missing* key is allowed and falls
   back to English at runtime, so you can translate incrementally.

Namespace by surface (`common`, `menu`, `settings`, `launcher`, …). Keep the
namespace tree shallow-ish and named after the app/panel it serves.

## Rolling out to the remaining ~194 files

The system is in place; converting a surface is mechanical:

1. `const { t } = useTranslation();`
2. Move each visible literal into `catalog/en.ts` under the surface's namespace.
3. Replace the literal with `t("namespace.key")`.
4. Translate the new keys in `zh.ts` (and others) as desired.

Reference conversions already done: the Settings window
(`apps/settings/SettingsApp.tsx` + `SettingsExplorer.tsx`, including the live
**Language** picker registered in `lib/settings/appSettings.ts`),
`apps/launcher/components/Sidebar.tsx`, and the native menu in
`main/.../managers/menuManager.ts`.

### Localizing registry-driven settings

App settings render from a static registry (`lib/settings/appSettings.ts`), not
from React, so labels can't call `t()` directly. Instead a setting/category
carries optional `labelKey` / `descriptionKey` (typed `TranslationKey`); the
Settings components resolve them via `useTranslation` at render time and fall
back to the static `label` / `description`. Enum options that need friendly text
(e.g. locale codes) carry `optionLabels: Record<value, label>`. The language
picker is the worked example.

## Adding a language

1. Append the code to `SUPPORTED_LOCALES` in `locales.ts`.
2. Add its `LOCALE_META` entry (native/English name, BCP-47 `intl` tag, `dir`).
3. Create `catalog/<code>.ts` (`satisfies LocaleMessages`) and register it in
   `catalog/index.ts`.

The Settings language picker, formatters, and fallback all read the registry, so
nothing else changes.

## Notes / trade-offs

- **Bundling:** renderer apps are built as IIFE bundles (no code-splitting), so
  every locale is bundled into every app. Fine for a few languages — text is tiny
  next to code. If it ever matters, split catalogs per-namespace and have each app
  import only what it renders, or lazy-load catalogs over `app://`.
- **No flash:** `initI18n()` runs in `renderApp` before the first paint, so
  windows never flash English before switching.
- **Main process:** system menu `role:` items are localized by Electron/macOS;
  only custom labels go through `t()`.
