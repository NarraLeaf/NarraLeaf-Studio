import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import { SLASH_AT_ALIAS_KEY, slashAtAliasDefault } from "@/lib/settings/slashAliasOptions";

/**
 * Reads the `editor.slashAtAlias` preference - whether "@" opens the story editor's action creator
 * alongside "/". Unset (the user never touched it) resolves to {@link slashAtAliasDefault}: on for a
 * Simplified-Chinese device, where the "/" key types "、", off otherwise.
 *
 * Follows the global-state broadcast, so a change made in the separate Settings window takes effect
 * in the editor at once (see {@link useGlobalSetting}).
 */
export function useSlashAtAlias(): boolean {
    return useGlobalSetting(SLASH_AT_ALIAS_KEY, stored =>
        typeof stored === "boolean" ? stored : slashAtAliasDefault());
}
