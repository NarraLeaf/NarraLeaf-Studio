import type { UIDocument, UIElement, UIElementId } from "@shared/types/ui-editor/document";
import {
    getUIStructuralChildSlot,
    isLinkedUIComponentElement,
    isUIStructuralWidgetPart,
} from "@shared/types/ui-editor/document";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { collectSubtreeElementIds } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { isValidUIInsertParent, resolveInsertTargetParent } from "./resolveInsertTargetParent";

/** A parent, and the child the added elements go in front of (`null`: after its last child). */
export type UIEditorAddTarget = {
    parentId: UIElementId;
    beforeChildId: UIElementId | null;
};

/**
 * Whether `parent` takes `added` - the top-level elements one gesture adds - as its children.
 *
 * Anything that takes an author's children takes them, which is the rule inserting a new widget
 * follows (`isValidUIInsertParent`), less a linked component instance, whose inside belongs to its
 * definition. A widget that holds only the parts it built - a Slider, a Switch, a plugin's widget that
 * declares `partSlots` - takes a paste made entirely of its own parts, each for a slot it has free: a
 * slot holds one part, and the widget draws only one, so a second would be an element nobody sees.
 */
export function parentTakesAddedElements(
    document: UIDocument,
    parent: UIElement,
    added: readonly (Pick<UIElement, "extra"> | undefined)[],
): boolean {
    if (isLinkedUIComponentElement(parent)) {
        return false;
    }
    if (isValidUIInsertParent(parent)) {
        return true;
    }
    if (added.length === 0) {
        return false;
    }
    const taken = new Set<string>();
    for (const childId of parent.childrenIds) {
        const slot = getUIStructuralChildSlot(parent.type, document.elements[childId]?.extra);
        if (slot) {
            taken.add(slot);
        }
    }
    for (const element of added) {
        const slot = getUIStructuralChildSlot(parent.type, element?.extra);
        if (!slot || taken.has(slot)) {
            return false;
        }
        taken.add(slot);
    }
    return true;
}

/**
 * Where elements aimed at `aim` land: there, or the nearest place above it that takes them.
 *
 * The walk is the one inserting a new widget makes - up through the parents until one takes the
 * element - with one addition: each parent the walk leaves behind, the elements land right after,
 * rather than at the end of the next parent's children. So a copy pasted beside a Slider's handle,
 * where the Slider will not take it, lands next to the Slider, which is the nearest place to where it
 * was aimed that can hold it.
 *
 * Null when nothing up to the surface's root takes them, or `aim` is not on this surface.
 */
export function settleAddTarget(
    document: UIDocument,
    surfaceId: string,
    aim: UIEditorAddTarget,
    added: readonly (Pick<UIElement, "extra"> | undefined)[],
): UIEditorAddTarget | null {
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
        if (parentTakesAddedElements(document, parent, added)) {
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
 * Where a gesture aimed at one element goes before it is settled: into the nearest parent that takes
 * an author's children, walking up from `aimedElementId`, as a new widget inserted there would.
 *
 * Except when the element aimed at is a part a widget built. A part is a container, and putting
 * something in one stays possible, but neither a paste nor the insert tool carries a promise that the
 * handle itself was meant to be decorated: both place by a geometry of their own - the layout the copy
 * came with, the rectangle the author drew - and in a part the size of a thumb, which clips what it
 * holds, that geometry lands outside it and is clipped away. Aimed at a part, the gesture is aimed at
 * its widget, which the settle then leaves for the widget's own parent. Adding to a part on purpose is
 * still one gesture away, from the entries that name the part as the destination: the layer outline's
 * Insert Child and Paste into Container, and a drag onto it.
 */
export function aimAddAtElement(
    document: UIDocument,
    surfaceId: string,
    aimedElementId: UIElementId | null | undefined,
    primaryElementId: UIElementId | null | undefined,
): UIEditorAddTarget | null {
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

/**
 * One element about to be created: it carries no part marker, so no widget takes it back as a part.
 *
 * `createElement` is what gives a new child of a Slider or a List its slot, and nothing resolved here
 * is such a parent - the walk settles on a parent that takes an author's children.
 */
const ONE_NEW_ELEMENT: readonly (Pick<UIElement, "extra"> | undefined)[] = [undefined];

/**
 * The parent a new element goes into for the gestures that name none: the insert tool's drag, the
 * canvas menu's Insert, an image dropped on the canvas.
 *
 * All three place the element by a geometry of their own and add it last among its siblings, so what
 * they need from the shared rule is the parent - the same parent a paste made with that selection
 * would settle on, `beforeChildId` apart. The pointer is deliberately not consulted: a new widget is
 * never dropped into whatever happened to be under the cursor, only into the selection's parent or
 * the surface root.
 */
export function resolveNewElementParent(
    document: UIDocument,
    surfaceId: string,
    primaryElementId: UIElementId | null | undefined,
): UIElementId | null {
    const aim = aimAddAtElement(document, surfaceId, null, primaryElementId);
    if (!aim) {
        return null;
    }
    return settleAddTarget(document, surfaceId, aim, ONE_NEW_ELEMENT)?.parentId ?? null;
}

function nextSiblingId(document: UIDocument, element: UIElement): UIElementId | null {
    const siblings = element.parentId ? document.elements[element.parentId]?.childrenIds ?? [] : [];
    const index = siblings.indexOf(element.id);
    return index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
}
