import { useSyncExternalStore } from "react";
import { Translator } from "@shared/i18n";
import { commandI18nStore } from "./commandLocale";

/**
 * Text in the story editor's command language — the action creator's menu, its category column, the
 * parameter candidates, the inline ghost hint and the command reference.
 *
 * Everything else keeps `useTranslation`. The dividing line is vocabulary versus prose: a slot named
 * `<Position>` is part of the grammar the author types, an error sentence explaining what went wrong
 * is not. A component often needs both.
 *
 * No `setLocale` counterpart — the preference is a setting, written through the settings page like
 * any other global-state key rather than from the editor.
 */
export function useCommandTranslation(): Translator {
    return useSyncExternalStore(
        commandI18nStore.subscribe,
        commandI18nStore.getTranslator,
        commandI18nStore.getTranslator,
    );
}
