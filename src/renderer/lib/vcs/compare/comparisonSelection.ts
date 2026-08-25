import type { DocumentChange } from "@shared/documents/diff";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";

/**
 * An element of one half of a comparison, as the app-wide selection carries it.
 *
 * The split halves are not inert pictures: an author can pick a child element out of one of them and
 * read its properties in the right rail, at the version that half is showing. That is a SELECTION -
 * the same thing selecting an element on the editing canvas is - so it travels the same way, as a
 * member of `SelectionState`, and the rail dispatches on it like every other kind.
 *
 * # The subject travels, already parsed
 *
 * The element and the document it came from are carried here rather than fetched by the rail. Both
 * halves have already read and parsed their version (`presenters/sideDocument.ts`) in order to draw
 * it, and the rail has no way to read a revision at all - it looks elements up by id in the LIVE
 * document, which is the one version this selection is never about. Carrying the parsed subject is
 * what makes the inspector version-stateless: it holds no comparison of its own and renders whatever
 * the selection hands it.
 *
 * That also settles what happens when the comparison is re-read under an open selection. The
 * selection is a snapshot and stays what it was; the tab clears it when the entry changes, because a
 * selection into a document that has been re-read is a selection into a document nobody is looking
 * at any more.
 *
 * # An element in one half only is a complete selection
 *
 * A removal is in the older half and nowhere else, and picking it is a perfectly good question - it
 * is often the whole question. So {@link counterpart} is null rather than the selection being
 * refused, and the rail says which version the element is from instead of drawing a blank. Same
 * rule the halves themselves keep for a gap: state the absence, never leave a hole that reads as
 * content which has not loaded.
 */

/** The discriminant, spelled once. Its member of `SelectionState` is owned by this module. */
export const COMPARISON_ELEMENT_SELECTION_TYPE = "comparisonElement";

/** Which half published the selection. `base` is the older version, `head` the newer. */
export type ComparisonHalf = "base" | "head";

export interface ComparisonElementSelection {
    /** Repository-relative path of the document being compared. Identity, not a read address. */
    readonly documentPath: string;
    readonly half: ComparisonHalf;
    /** What that half calls its version, already resolved to text by the tab that knows. */
    readonly versionLabel: string;
    /** What the OTHER half calls its version. The strip names it when the element is not in it. */
    readonly counterpartLabel: string;
    readonly surfaceId: string;
    readonly elementId: string;
    /** The element, out of that half's parsed document. */
    readonly element: UIElement;
    /** That half's whole document, so a field can resolve a parent, a component or a binding. */
    readonly document: UIDocument;
    /** The same element in the other half, or null when that half does not hold it. */
    readonly counterpart: UIElement | null;
    /** The other half's document, for the fields that read one. Null when there is no other half. */
    readonly counterpartDocument: UIDocument | null;
}

/** Where in a UI document a change is, when it is about an element of a Surface. */
export interface ComparisonElementAddress {
    readonly surfaceId: string;
    readonly elementId: string;
}

/**
 * The element a change row is about, or null.
 *
 * The addressing is `uiDocumentDiff`'s and is read as positions rather than parsed out of display
 * text, the same way `surfaceDiffPlan` reads it: four segments under `surfaces` is an element of a
 * Surface, and a fifth is one of its properties - which is still that element, so a child row about
 * `layout` selects the element the layout belongs to.
 *
 * Everything else answers null on purpose. A component definition's insides are not on any Surface,
 * a detached element is on none, and the document's own name is not an element at all.
 */
export function comparisonElementAddress(change: DocumentChange): ComparisonElementAddress | null {
    const path = change.path;
    if (path.length < 4 || path.length > 5) {
        return null;
    }
    if (path[0] !== "surfaces" || path[2] !== "elements") {
        return null;
    }
    return { surfaceId: path[1], elementId: path[3] };
}

/**
 * Build the selection one half publishes for one element, or null when that half has no such
 * element.
 *
 * Null rather than an empty selection: a row can name an element the half does not hold - a child
 * row of a change drawn on both sides, an addressing an older document spells differently - and a
 * selection whose element is missing would put the rail's empty state behind a row that looks
 * pressable.
 */
export function buildComparisonElementSelection(input: {
    readonly documentPath: string;
    readonly half: ComparisonHalf;
    readonly versionLabel: string;
    readonly counterpartLabel: string;
    readonly address: ComparisonElementAddress;
    readonly document: UIDocument | null;
    readonly counterpartDocument: UIDocument | null;
}): ComparisonElementSelection | null {
    const element = input.document?.elements[input.address.elementId];
    if (!input.document || !element) {
        return null;
    }
    return {
        documentPath: input.documentPath,
        half: input.half,
        versionLabel: input.versionLabel,
        counterpartLabel: input.counterpartLabel,
        surfaceId: input.address.surfaceId,
        elementId: input.address.elementId,
        element,
        document: input.document,
        counterpart: input.counterpartDocument?.elements[input.address.elementId] ?? null,
        counterpartDocument: input.counterpartDocument ?? null,
    };
}

/** Whether two selections are the same element of the same half of the same comparison. */
export function isSameComparisonElement(
    a: ComparisonElementSelection | null,
    b: ComparisonElementSelection | null,
): boolean {
    if (!a || !b) {
        return false;
    }
    return a.documentPath === b.documentPath
        && a.half === b.half
        && a.surfaceId === b.surfaceId
        && a.elementId === b.elementId;
}
