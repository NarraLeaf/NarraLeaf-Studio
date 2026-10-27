import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import {
    GROUP_SUBMENUS_KEY,
    CHARACTER_LIST_GROUPING_KEY,
    resolveGroupSubmenus,
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
 * Reads the `editor.groupSubmenus` preference — whether the story editor's candidate menus show each
 * cast group and asset folder as one entry with its contents in a column beside it. Follows the
 * broadcast for the same reason as above.
 */
export function useGroupSubmenus(): boolean {
    return useGlobalSetting(GROUP_SUBMENUS_KEY, resolveGroupSubmenus);
}
