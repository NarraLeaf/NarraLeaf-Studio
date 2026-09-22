import type { UIDocument, UIElement, UIElementId } from "@shared/types/ui-editor/document";
import {
    getUIStructuralChildSlot,
    isLinkedUIComponentElement,
    isUIStructuralWidgetPart,
} from "@shared/types/ui-editor/document";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { collectSubtreeElementIds } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { isValidUIInsertParent, resolveInsertTargetParent } from "./resolveInsertTargetParent";

/** A parent, and the child the pasted elements go in front of (`null`: after its last child). */
export type UIEditorPasteTarget = {
    parentId: UIElementId;
    beforeChildId: UIElementId | null;
};

/**
 * Whether `parent` takes `pasted` - the top-level elements of one paste - as its children.
 *
 * Anything that takes an author's children takes a paste, which is the rule inserting a new widget
 * follows (`isValidUIInsertParent`), less a linked component instance, whose inside belongs to its
 * definition. A widget that holds only the parts it built - a Slider, a Switch, a plugin's widget that
 * declares `partSlots` - takes a paste made entirely of its own parts, each for a slot it has free: a
 * slot holds one part, and the widget draws only one, so a second would be an element nobody sees.
 */
export function pasteParentAccepts(
    document: UIDocument,
    parent: UIElement,
    pasted: readonly (Pick<UIElement, "extra"> | undefined)[],
): boolean {
    if (isLinkedUIComponentElement(parent)) {
        return false;
    }
    if (isValidUIInsertParent(parent)) {
        return true;
    }
    if (pasted.length === 0) {
        return false;
    }
    const taken = new Set<string>();
    for (const childId of parent.childrenIds) {
        const slot = getUIStructuralChildSlot(parent.type, document.elements[childId]?.extra);
        if (slot) {
            taken.add(slot);
        }
    }
    for (const element of pasted) {
        const slot = getUIStructuralChildSlot(parent.type, element?.extra);
        if (!slot || taken.has(slot)) {
            return false;
        }
        taken.add(slot);
    }
    return true;
}

/**
 * Where a paste aimed at `aim` lands: there, or the nearest place above it that takes what is pasted.
 *
 * The walk is the one inserting a new widget makes - up through the parents until one takes the
 * element - with one addition a paste needs and an insert does not: each parent the walk leaves
 * behind, the paste lands right after, rather than at the end of the next parent's children. So a
 * copy pasted beside a Slider's handle, where the Slider will not take it, lands next to the Slider,
 * which is the nearest place to where it was aimed that can hold it.
 *
 * Null when nothing up to the surface's root takes it, or `aim` is not on this surface.
 */
export function settlePasteTarget(
    document: UIDocument,
    surfaceId: string,
    aim: UIEditorPasteTarget,
    pasted: readonly (Pick<UIElement, "extra"> | undefined)[],
): UIEditorPasteTarget | null {
    const rootId = resolveSurfaceRootElementId(document, surfaceId);
    if (!rootId) {
        return null;
    }
    const allowed = collectSubtreeElementIds(document, rootId);
    let parentId: UIElementId | null = aim.parentId;
    let beforeChildId = aim.beforeChildId;
    while (parentId && allowed.has(parentId)) {
        const parent: UIElement | undefined = document.elements[parentId];
        if (!parent) {
            return null;
        }
        if (pasteParentAccepts(document, parent, pasted)) {
            const before = beforeChildId != null ? document.elements[beforeChildId] : undefined;
            return { parentId, beforeChildId: before?.parentId === parentId ? before.id : null };
        }
        if (parentId === rootId || !parent.parentId) {
            return null;
        }
        beforeChildId = nextSiblingId(document, parent);
        parentId = parent.parentId;
    }
    return null;
}

/**
 * Where a paste aimed at one element goes before it is settled: into the nearest parent that takes
 * an author's children, walking up from `aimedElementId`, as a new widget inserted there would.
 *
 * Except when the element aimed at is a part a widget built. A part is a container, and inserting
 * into one stays possible, but a paste carries no position to say it was meant to decorate the
 * handle: it lands wherever its copied layout puts it, which in a part the size of a thumb is outside
 * the part and clipped away - a paste that looked like it did nothing. Aimed at a part, the paste is
 * aimed at its widget, which the settle then leaves for the widget's own parent. Pasting into a part
 * on purpose is still one gesture away: the layer outline's Paste into Container names the part.
 */
export function aimPasteAtElement(
    document: UIDocument,
    surfaceId: string,
    aimedElementId: UIElementId | null | undefined,
    primaryElementId: UIElementId | null | undefined,
): UIEditorPasteTarget | null {
    const aimedId = aimedElementId ?? primaryElementId ?? null;
    const aimed = aimedId ? document.elements[aimedId] : undefined;
    if (aimed && aimed.parentId && isUIStructuralWidgetPart(document, aimed)) {
        return { parentId: aimed.parentId, beforeChildId: nextSiblingId(document, aimed) };
    }
    const resolved = resolveInsertTargetParent(document, surfaceId, {
        hitElementId: aimedElementId,
        primaryElementId,
    });
    return resolved ? { parentId: resolved.parentId, beforeChildId: null } : null;
}

function nextSiblingId(document: UIDocument, element: UIElement): UIElementId | null {
    const siblings = element.parentId ? document.elements[element.parentId]?.childrenIds ?? [] : [];
    const index = siblings.indexOf(element.id);
    return index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
}
