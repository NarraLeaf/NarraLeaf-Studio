import { useSyncExternalStore } from "react";
import { getInterface } from "@/lib/app/bridge";
import { LocaleCode, Translator } from "@shared/i18n";
import { i18nStore } from "./store";

export interface UseTranslation extends Translator {
    /**
     * Change the app language. Updates this window immediately (optimistic) and
     * persists to global state, which the main process broadcasts so every other
     * window updates too.
     */
    setLocale(next: LocaleCode): void;
}

/**
 * The one hook components use for text:
 *
 *   const { t, tn, locale, setLocale, formatDate } = useTranslation();
 *   <h1>{t("settings.title")}</h1>
 *   <span>{tn("launcher.recentCount", projects.length)}</span>
 */
export function useTranslation(): UseTranslation {
    const translator = useSyncExternalStore(
        i18nStore.subscribe,
        i18nStore.getTranslator,
        i18nStore.getTranslator,
    );

    const setLocale = (next: LocaleCode): void => {
        i18nStore.setLocale(next); // optimistic: this window reacts without waiting on IPC
        void getInterface().app.state.setGlobalState("app.language", next);
    };

    return { ...translator, setLocale };
}
