import type { UIElement } from "@shared/types/ui-editor/document";

/**
 * Where a widget's words come from, as its inspector offers the choice. Shared by every widget whose
 * words a player reads and a translation key can replace - the text widget's `text`, the button's
 * `label`.
 *
 * - `literal`: the element's own words (translated through its own unit when `localizable`).
 * - `key`: a named translation key; the game shows the key's text and never the element's own.
 * - `blueprint`: a Blueprint Value writes the words.
 */
export type LabelSource = "literal" | "key" | "blueprint";

/**
 * The source a stored element's words are read from - derived, not stored.
 *
 * In the order the game resolves them: a key wins over everything (`useLocalizedWidgetText` reads
 * it before the words it was handed), so an element that also carries words of its own or a
 * Blueprint Value is a keyed one. `keysApply` is false while the project has no source language: a
 * build then carries no keys, and the game shows the element's own words.
 *
 * Null for a list template's element whose words are bound to a field of its row (and to no key),
 * which is answered by the row and offers none of the three.
 *
 * @param propPath the prop holding the words (`text`, `label`)
 * @param localizationKey the element's key, as its widget reads it
 */
export function labelSourceOf(
    element: UIElement,
    propPath: string,
    localizationKey: string | undefined,
    keysApply: boolean,
): LabelSource | null {
    if (keysApply && localizationKey?.trim()) {
        return "key";
    }
    const binding = element.valueBindings?.[propPath];
    if (binding?.kind === "listItemField") {
        return null;
    }
    if (binding?.kind === "blueprintValue") {
        return "blueprint";
    }
    return "literal";
}
