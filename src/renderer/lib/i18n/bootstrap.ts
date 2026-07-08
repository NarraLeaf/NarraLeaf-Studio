import { getInterface } from "@/lib/app/bridge";
import { normalizeLocale } from "@shared/i18n";
import { i18nStore } from "./store";

let subscribed = false;

/**
 * Load the persisted language and wire live updates. Call once, before the first
 * React render (renderApp does this), so the window paints in the right language
 * with no flash of source-locale text.
 *
 * Also subscribes to the main-process broadcast so changing the language in the
 * Settings window updates every other open window instantly.
 */
export async function initI18n(): Promise<void> {
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
    }
}
