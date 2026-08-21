import { createTranslator, DEFAULT_LOCALE, normalizeLocale, resolvePreferredLocale, Translator, type LocaleCode } from "@shared/i18n";
import type { BaseApp } from "./baseApp";

/**
 * The machine's languages, as Electron reports them.
 *
 * Reached through a require rather than a top-level import, and that is load-bearing: this module is
 * imported by `GameBuildManager`, which is unit-tested, and the test runner cannot resolve
 * `electron/main`. A top-level import there makes those files stop *collecting* rather than fail, so
 * a hundred passing tests vanish from the run without anything turning red. Main is bundled as CJS,
 * so the require resolves normally at runtime; only the stored-language path is taken in tests.
 */
function systemLanguages(): string[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron/main") as typeof import("electron/main");
    return [...app.getPreferredSystemLanguages(), app.getLocale()];
}

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
    // A command-line build states its language rather than inheriting one. Half of a build's console
    // is written here and half in the workspace, and a machine set to another language produced a log
    // in two languages at once - neither of them chosen by whoever reads it. The workspace side pins
    // itself the same way; see `runCommandLineBuild`. Nothing else about the run changes, and this
    // launch opens no menu, no dialog and no window for the choice to be visible in anyway.
    if (app.getCommandLineBuild()) {
        return DEFAULT_LOCALE;
    }
    const stored = app.globalState.get("app.language");
    if (typeof stored === "string" && stored.length > 0) {
        return normalizeLocale(stored);
    }
    return resolvePreferredLocale(systemLanguages());
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
