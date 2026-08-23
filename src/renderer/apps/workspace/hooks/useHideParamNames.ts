import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import { HIDE_PARAM_NAMES_DEFAULT, HIDE_PARAM_NAMES_KEY } from "@/lib/settings/commandParamNameOptions";

/**
 * Reads the `editor.hideParamNames` preference — whether a committed story row prints only the values
 * of its modifiers (`@hide Anyo fade`) rather than the whole `key=value` pair (`@hide Anyo t=fade`).
 *
 * Follows the global-state broadcast, so a change made in the separate Settings window re-prints the
 * rows behind it at once (see {@link useGlobalSetting}).
 */
export function useHideParamNames(): boolean {
    return useGlobalSetting(HIDE_PARAM_NAMES_KEY, stored =>
        typeof stored === "boolean" ? stored : HIDE_PARAM_NAMES_DEFAULT);
}
