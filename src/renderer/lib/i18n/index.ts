/**
 * React bindings for the shared i18n core.
 *
 * Bootstrap once per window (renderApp calls `initI18n`), then read text with
 * `useTranslation`. Locale metadata / types come from `@shared/i18n`.
 */
export { initI18n } from "./bootstrap";
export { useTranslation } from "./useTranslation";
export type { UseTranslation } from "./useTranslation";
export { i18nStore } from "./store";
