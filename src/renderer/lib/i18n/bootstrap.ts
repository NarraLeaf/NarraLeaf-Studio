import { getInterface } from "@/lib/app/bridge";
import { normalizeLocale, setLocaleContributions } from "@shared/i18n";
import { LOCALIZED_COMMANDS_KEY } from "@/lib/settings/commandLanguageOptions";
import { commandI18nStore } from "./commandLocale";
import { deviceDefaultLocale } from "./deviceLocale";
import { i18nStore } from "./store";

let subscribed = false;
/**
 * The persisted `app.language` value, kept raw. A plugin locale that is not
 * registered right now still has to be remembered: the plugin may come back
 * (re-enabled, re-authorized after an update) and the preference must survive
 * the gap rather than being flattened to whatever it degraded to.
 */
let preference: unknown = undefined;

/**
 * Fetch the aggregated plugin language packs from the main process and push them
 * into this window's locale registry. Registering them notifies the store, so
 * mounted UI re-localizes and the language picker lists plugin locales.
 */
async function loadPluginLocales(): Promise<void> {
    try {
        const result = await getInterface().plugins?.getLocaleContributions?.();
        if (result?.success) {
            setLocaleContributions(result.data.contributions);
        }
    } catch (error) {
        console.warn("[i18n] Failed to load plugin locale contributions.", error);
    }
}

/**
 * Re-resolve the stored preference against the locales registered *now*.
 *
 * `normalizeLocale` reads the live registry, so this is what makes a plugin
 * locale degrade the same way whether it disappears mid-session or was already
 * gone at startup: "zh-x-neko" falls back to its `zh` primary subtag either way.
 * Without it a window that loses a pack keeps holding the dead code and every
 * lookup misses into the `en` fallback instead — same broken state, two
 * different languages depending on how you got there.
 */
function applyPreference(): void {
    // No stored value means nobody has chosen yet, which is a different question from "chose
    // something this build does not have": the first is answered by the machine's own languages,
    // the second by the fallback chain inside `normalizeLocale`. Collapsing them is what had
    // Studio open in English on a device that had already said otherwise.
    i18nStore.setLocale(preference === undefined ? deviceDefaultLocale() : normalizeLocale(preference));
}

/**
 * Load the persisted language and wire live updates. Call once, before the first
 * React render (renderApp does this), so the window paints in the right language
 * with no flash of source-locale text.
 *
 * Plugin language packs are registered first so a persisted plugin locale (e.g.
 * "ja") resolves instead of collapsing to the fallback. Subscribes to the
 * main-process broadcasts so changing the language in Settings, or the enabled
 * plugin set changing, updates every window instantly.
 *
 * Both locale axes are loaded here. `editor.localizedCommands` needs no
 * `applyPreference` twin: `commandI18nStore` resolves against the interface
 * locale on every read, and it subscribes to `i18nStore`, so the interface
 * language moving is already enough to move it.
 */
export async function initI18n(): Promise<void> {
    await loadPluginLocales();

    try {
        const result = await getInterface().app.state.getGlobalState("app.language");
        if (result.success) {
            preference = result.data.value;
            applyPreference();
        }
    } catch (error) {
        console.warn("[i18n] Failed to load language preference; using default.", error);
    }

    try {
        const result = await getInterface().app.state.getGlobalState(LOCALIZED_COMMANDS_KEY);
        if (result.success) {
            commandI18nStore.setPreference(result.data.value);
        }
    } catch (error) {
        console.warn("[i18n] Failed to load command language preference; following the interface language.", error);
    }

    if (!subscribed) {
        subscribed = true;
        getInterface().app.state.onGlobalStateChanged?.((change) => {
            if (change.key === "app.language") {
                preference = change.value;
                applyPreference();
            }
            if (change.key === LOCALIZED_COMMANDS_KEY) {
                commandI18nStore.setPreference(change.value);
            }
        });
        getInterface().plugins?.onLocalesChanged?.(() => {
            void loadPluginLocales().then(applyPreference);
        });
    }
}
