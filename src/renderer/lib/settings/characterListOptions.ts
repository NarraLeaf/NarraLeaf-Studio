/**
 * Single source of truth for the "character lists" preference (`editor.characterListGrouping`).
 *
 * Shared between the settings registry (`appSettings.ts`) and everything that offers the cast for
 * picking - the story editor's speaker picker and the voice table's speaker filter - so the key, its
 * values and its default never drift apart.
 *
 * Comments in English per project convention.
 */

/**
 * How a list of characters is arranged where one is picked.
 *
 *  - `"grouped"` — the ungrouped cast first, then each cast group under its name, in the order the
 *    Characters panel files them. One filing, wherever a character is looked for.
 *  - `"all"` — every character in one flat list, in the order the project holds them. What a small
 *    cast wants, and what a search-as-you-type reaches for: nothing between the names.
 */
export type CharacterListGrouping = "grouped" | "all";

/** Global-state key the preference is stored under. */
export const CHARACTER_LIST_GROUPING_KEY = "editor.characterListGrouping" as const;

/** The two values, in the order the settings page offers them. */
export const CHARACTER_LIST_GROUPING_OPTIONS: readonly CharacterListGrouping[] = ["grouped", "all"];

/**
 * Grouped by default.
 *
 * A project that has no cast groups sees no difference - with nothing to file under, the grouped
 * list IS the flat one - so the default only shows itself on the projects that did the filing, where
 * repeating it is the answer. An author who would rather have the flat list says so once.
 */
export const CHARACTER_LIST_GROUPING_DEFAULT: CharacterListGrouping = "grouped";

/** Narrow an unknown stored value to an arrangement, falling back to the default. */
export function resolveCharacterListGrouping(stored: unknown): CharacterListGrouping {
    return CHARACTER_LIST_GROUPING_OPTIONS.includes(stored as CharacterListGrouping)
        ? stored as CharacterListGrouping
        : CHARACTER_LIST_GROUPING_DEFAULT;
}

/** Global-state key for whether the speaker picker's cast groups start folded. */
export const CHARACTER_GROUPS_COLLAPSED_KEY = "editor.characterGroupsCollapsed" as const;

/**
 * Folded by default.
 *
 * The picker is opened to take one name, and a cast large enough to be filed into groups is a long
 * list to scroll past for it. The headers alone say where everyone is; a click opens one, and typing
 * opens them all.
 */
export const CHARACTER_GROUPS_COLLAPSED_DEFAULT = true;

/** Narrow an unknown stored value to the folding preference, falling back to the default. */
export function resolveCharacterGroupsCollapsed(stored: unknown): boolean {
    return typeof stored === "boolean" ? stored : CHARACTER_GROUPS_COLLAPSED_DEFAULT;
}
