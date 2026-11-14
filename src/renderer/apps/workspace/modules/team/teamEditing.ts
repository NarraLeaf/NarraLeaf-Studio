import { editorSubjectOf, type ScopeTab } from "../lint/problemsScope";

/**
 * The document a tab has open, in the anchor terms Team and the web console share - `story:<id>`
 * for any of a story's scenes or its flow, `ui:<id>` for a blueprint - or null for a tab that is
 * not about one (a character, an asset, a settings page).
 *
 * Coarse on purpose: two people in different scenes of one chapter are still worth telling about
 * each other, and a scene id would make the hint miss exactly that.
 */
export function teamEditingDocument(tab: ScopeTab | null): string | null {
    if (tab === null) return null;
    const subject = editorSubjectOf(tab);
    if (subject === null) return null;
    switch (subject.kind) {
        case "storyScene":
        case "story":
            return `story:${subject.storyId}`;
        case "blueprint":
            return `ui:${subject.blueprintId}`;
        default:
            return null;
    }
}
