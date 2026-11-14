import { getInterface } from "@/lib/app/bridge";
import { loadBuiltinCatalog, normalizeLocale, setLocaleContributions } from "@shared/i18n";
import { LOCALIZED_COMMANDS_KEY } from "@/lib/settings/commandLanguageOptions";
import { observeGlobalSettings } from "@/lib/settings/observeGlobalSettings";
import { commandI18nStore } from "./commandLocale";
import { deviceDefaultLocale } from "./deviceLocale";
import { i18nStore } from "./store";

let subscribed = false;
let observer: ReturnType<typeof observeGlobalSettings> | null = null;
let receivedPreference = false;
let localeLoadGeneration = 0;
let latestLocaleLoad: Promise<void> | null = null;
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
function loadPluginLocales(): Promise<void> {
    const generation = ++localeLoadGeneration;
    const load = (async () => {
        try {
            const result = await getInterface().plugins?.getLocaleContributions?.();
            if (generation === localeLoadGeneration && result?.success) {
                setLocaleContributions(result.data.contributions);
            }
        } catch (error) {
            console.warn("[i18n] Failed to load plugin locale contributions.", error);
        }
    })();
    latestLocaleLoad = load;
    return load;
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
 * Language packs and preferences are loaded before the first paint. The raw preference is
 * resolved again when the packs arrive, so a plugin locale is available immediately. Subscribes
 * to main-process broadcasts so language and plugin changes update every window.
 *
 * Both locale axes are loaded here. `editor.localizedCommands` needs no
 * `applyPreference` twin: `commandI18nStore` resolves against the interface
 * locale on every read, and it subscribes to `i18nStore`, so the interface
 * language moving is already enough to move it.
 */
export async function initI18n(): Promise<void> {
    observer ??= observeGlobalSettings(
        ["app.language", LOCALIZED_COMMANDS_KEY],
        (key, value) => {
            if (key === "app.language") {
                receivedPreference = true;
                preference = value;
                applyPreference();
            } else if (key === LOCALIZED_COMMANDS_KEY) {
                commandI18nStore.setPreference(value);
            }
        },
        (key, error) => {
            const message = key === "app.language"
                ? "[i18n] Failed to load language preference."
                : "[i18n] Failed to load command language preference.";
            console.warn(message, error);
        },
    );
    if (!subscribed) {
        subscribed = true;
        getInterface().plugins?.onLocalesChanged?.(() => {
            void loadPluginLocales().then(applyPreference);
        });
    }
    let loading = loadPluginLocales();
    do {
        await loading;
        if (loading === latestLocaleLoad) break;
        loading = latestLocaleLoad!;
    } while (true);
    await observer.ready;
    if (receivedPreference) {
        // A plugin locale can be selected while its contribution is still loading.
        applyPreference();
    }
    // The windows built without every catalog fetch the interface language here, so the first paint
    // is already in it rather than in English for a frame. Resolves at once in every other window.
    await loadBuiltinCatalog(i18nStore.getLocale());
}
