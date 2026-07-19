import { createTranslator, normalizeLocale, Translator } from "@shared/i18n";
import type { BaseApp } from "./baseApp";

/**
 * Build a translator for the main process using the currently persisted
 * language. The main process owns global state, so it reads the value directly
 * (no IPC). Call this fresh wherever main-process text is produced - native
 * menu, dialogs, notifications - so the string reflects the latest choice.
 */
export function getMainTranslator(app: BaseApp): Translator {
    const locale = normalizeLocale(app.globalState.get("app.language"));
    return createTranslator(locale);
}
