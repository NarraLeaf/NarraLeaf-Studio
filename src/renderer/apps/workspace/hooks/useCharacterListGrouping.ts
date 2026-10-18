import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import {
    CHARACTER_LIST_GROUPING_KEY,
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
