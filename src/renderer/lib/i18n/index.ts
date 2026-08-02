/**
 * React bindings for the shared i18n core.
 *
 * Bootstrap once per window (renderApp calls `initI18n`), then read text with
 * `useTranslation`. Locale metadata / types come from `@shared/i18n`.
 *
 * A second axis lives alongside it: the story editor's command vocabulary reads
 * `useCommandTranslation` / `translateCommand`, which follow the
 * `editor.localizedCommands` setting instead of the interface language. See
 * `./commandLocale`.
 */
export { initI18n } from "./bootstrap";
export { useTranslation } from "./useTranslation";
export type { UseTranslation } from "./useTranslation";
export { i18nStore, translate, translateN } from "./store";
export { commandI18nStore, translateCommand } from "./commandLocale";
export { useCommandTranslation } from "./useCommandTranslation";
