import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import {
    CHARACTER_GROUPS_COLLAPSED_KEY,
    CHARACTER_LIST_GROUPING_KEY,
    resolveCharacterGroupsCollapsed,
    resolveCharacterListGrouping,
    type CharacterListGrouping,
} from "@/lib/settings/characterListOptions";

/**
 * Reads the `editor.characterListGrouping` preference — whether a list of characters is filed under
 * the cast groups or offered as one flat list.
 *
 * Follows the global-state broadcast, so a change made in the separate Settings window rearranges
 * the menu behind it while the author is still looking at the option they picked.
 */
export function useCharacterListGrouping(): CharacterListGrouping {
    return useGlobalSetting(CHARACTER_LIST_GROUPING_KEY, resolveCharacterListGrouping);
}

/**
 * Reads the `editor.characterGroupsCollapsed` preference — whether the speaker picker opens with its
 * cast groups folded to their headers. Follows the broadcast for the same reason as above.
 */
export function useCharacterGroupsCollapsed(): boolean {
    return useGlobalSetting(CHARACTER_GROUPS_COLLAPSED_KEY, resolveCharacterGroupsCollapsed);
}
