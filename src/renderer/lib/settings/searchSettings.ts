import { SettingCategory, SettingDescriptor } from "@/lib/settings/models";

/**
 * Search matching for the Settings window, shared by the two surfaces that have to agree on it:
 * the navigation tree and the settings list. Kept here rather than inside either one so a query
 * can never leave the tree showing a category the list has filtered away, or the reverse.
 */

/** Whether a setting row matches; the query is expected pre-trimmed but is normalized anyway. */
export function settingMatchesQuery(descriptor: SettingDescriptor, query: string): boolean {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return true;
    }
    const targets = [
        descriptor.label,
        descriptor.description,
        descriptor.id,
        ...(descriptor.options ?? []),
    ];
    return targets.some(text => text?.toLowerCase().includes(needle));
}

/**
 * Whether the category itself matches. A category hit keeps all of its settings — searching for
 * "editor" should show what the Editor category holds, not just the rows repeating the word.
 */
export function categoryMatchesQuery(category: SettingCategory, query: string): boolean {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return true;
    }
    return (
        category.label.toLowerCase().includes(needle) ||
        category.description.toLowerCase().includes(needle)
    );
}

/**
 * The rows to show for one category under a query: every row when the category itself matched or
 * the query is empty, else only the matching rows. Returns null when the category drops out.
 */
export function filterCategoryEntries<T extends { descriptor: SettingDescriptor }>(
    category: SettingCategory,
    entries: T[],
    query: string,
): T[] | null {
    if (!query.trim()) {
        return entries;
    }
    if (categoryMatchesQuery(category, query)) {
        return entries;
    }
    const matched = entries.filter(entry => settingMatchesQuery(entry.descriptor, query));
    return matched.length > 0 ? matched : null;
}
