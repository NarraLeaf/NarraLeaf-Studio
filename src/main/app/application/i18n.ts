import { app as electronApp } from "electron/main";
import { createTranslator, normalizeLocale, resolvePreferredLocale, Translator, type LocaleCode } from "@shared/i18n";
import type { BaseApp } from "./baseApp";

/**
 * The language main-process text is produced in.
 *
 * A stored `app.language` wins. With none stored the key resolves to whatever this machine asked
 * for, through the same `resolvePreferredLocale` the renderer uses on `navigator.languages` - so
 * the native menu is in the language the windows are in, rather than English underneath a Chinese
 * interface.
 *
 * `getPreferredSystemLanguages()` is the ordered list; `getLocale()` is the single tag Chromium
 * settled on, kept as a tail entry because the ordered list is empty on some Linux setups.
 */
export function getMainLocale(app: BaseApp): LocaleCode {
    const stored = app.globalState.get("app.language");
    if (typeof stored === "string" && stored.length > 0) {
        return normalizeLocale(stored);
    }
    return resolvePreferredLocale([
        ...electronApp.getPreferredSystemLanguages(),
        electronApp.getLocale(),
    ]);
}

/**
 * Build a translator for the main process using the currently persisted
 * language. The main process owns global state, so it reads the value directly
 * (no IPC). Call this fresh wherever main-process text is produced - native
 * menu, dialogs, notifications - so the string reflects the latest choice.
 */
export function getMainTranslator(app: BaseApp): Translator {
    return createTranslator(getMainLocale(app));
}
