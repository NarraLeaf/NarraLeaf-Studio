import { getInterface } from "@/lib/app/bridge";
import { normalizeLocale, setLocaleContributions } from "@shared/i18n";
import { i18nStore } from "./store";

let subscribed = false;

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
 * Load the persisted language and wire live updates. Call once, before the first
 * React render (renderApp does this), so the window paints in the right language
 * with no flash of source-locale text.
 *
 * Plugin language packs are registered first so a persisted plugin locale (e.g.
 * "ja") resolves instead of collapsing to the fallback. Subscribes to the
 * main-process broadcasts so changing the language in Settings, or the enabled
 * plugin set changing, updates every window instantly.
 */
export async function initI18n(): Promise<void> {
    await loadPluginLocales();

    try {
        const result = await getInterface().app.state.getGlobalState("app.language");
        if (result.success) {
            i18nStore.setLocale(normalizeLocale(result.data.value));
        }
    } catch (error) {
        console.warn("[i18n] Failed to load language preference; using default.", error);
    }

    if (!subscribed) {
        subscribed = true;
        getInterface().app.state.onGlobalStateChanged?.((change) => {
            if (change.key === "app.language") {
                i18nStore.setLocale(normalizeLocale(change.value));
            }
        });
        getInterface().plugins?.onLocalesChanged?.(() => {
            void loadPluginLocales();
        });
    }
}
