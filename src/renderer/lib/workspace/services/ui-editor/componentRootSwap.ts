import type { UIComponentDefinition, UIDocument, UIElement, UILayout } from "@shared/types/ui-editor/document";
import { getUIComponentLink, isUIFlowLayoutParentElement } from "@shared/types/ui-editor/document";
import { parseContainerLayoutKind } from "@shared/types/ui-editor/container";
import { roundUILayoutGeometryFields } from "@/lib/ui-editor/layout/roundLayoutGeometry";

/**
 * Changing which element is a component's root: taking the container off a definition that holds one
 * element, so that element is the root, and putting a container around the root.
 *
 * A new component starts as an empty container named after the root, and a definition made from one
 * element on a page has that element for its root - which is how the starter's buttons are shaped, a
 * shape an author building a component from scratch could not reach. These two are the way between
 * the shapes, in the definition's own editor.
 */

/** Why an element cannot be made its definition's root; see {@link resolveComponentRootPromotionRefusal}. */
export type ComponentRootPromotionRefusal =
    /** Not one of the root's own children: only what sits directly in the root can replace it. */
    | "notInRoot"
    /** The root is a widget of its own - a button, say - rather than a container to take off. */
    | "rootNotContainer"
    /** The root holds other elements as well, which would have nowhere to go. */
    | "notAlone"
    /** The root places its children itself (stack or scroll), so where the element is drawn is not stored. */
    | "rootNotFree";

/**
 * Whether `elementId` can become the root of the definition whose elements and root are given, and if
 * not, why.
 *
 * Only an element alone in a root container that places its children freely: the container is taken
 * off, so it must be no more than a container around one thing, and the element's stored position
 * must be where it is drawn, because that is what keeps every placement looking as it did.
 */
export function resolveComponentRootPromotionRefusal(
    elements: Record<string, UIElement>,
    rootElementId: string,
    elementId: string,
): ComponentRootPromotionRefusal | null {
    const root = elements[rootElementId];
    const element = elements[elementId];
    if (!root || !element || element.parentId !== rootElementId || elementId === rootElementId) {
        return "notInRoot";
    }
    if (root.type !== "nl.container") {
        return "rootNotContainer";
    }
    if (root.childrenIds.length !== 1) {
        return "notAlone";
    }
    if (parseContainerLayoutKind(root.props) !== "free") {
        return "rootNotFree";
    }
    return null;
}

/** Every element on the project's pages that places this definition. */
export function collectComponentPlacementIds(document: UIDocument, componentId: string): string[] {
    return Object.values(document.elements)
        .filter(element => getUIComponentLink(element)?.componentId === componentId)
        .map(element => element.id);
}

/** The box a layout draws, whatever the signs of its size. */
function drawnBox(layout: UILayout): { x: number; y: number; width: number; height: number } {
    return {
        x: layout.x + Math.min(0, layout.width),
        y: layout.y + Math.min(0, layout.height),
        width: Math.abs(layout.width),
        height: Math.abs(layout.height),
    };
}

/**
 * Make `elementId` the definition's root, taking off the container it sat alone in.
 *
 * The definition becomes the element's size. A placement draws the definition scaled to its own box,
 * so each placement on the pages is given the box the element took up inside it: the element is
 * drawn where it was and at the size it was, and the container's empty margin goes. A placement whose
 * parent lays it out (a stack, a list) keeps its position, which is its parent's to give.
 *
 * Returns false and changes nothing when the element cannot be the root
 * ({@link resolveComponentRootPromotionRefusal}).
 */
export function promoteElementToComponentRoot(document: UIDocument, componentId: string, elementId: string): boolean {
    const component = (document.components ?? []).find(item => item.id === componentId);
    if (!component || resolveComponentRootPromotionRefusal(component.elements, component.rootElementId, elementId)) {
        return false;
    }
    const container = component.elements[component.rootElementId]!;
    const element = component.elements[elementId]!;
    const frame = drawnBox(container.layout);
    const box = drawnBox(element.layout);
    const frameWidth = Math.max(1, frame.width);
    const frameHeight = Math.max(1, frame.height);

    for (const placementId of collectComponentPlacementIds(document, componentId)) {
        const placement = document.elements[placementId];
        if (!placement) {
            continue;
        }
        const scaleX = placement.layout.width / frameWidth;
        const scaleY = placement.layout.height / frameHeight;
        const parent = placement.parentId ? document.elements[placement.parentId] : undefined;
        const laidOutByParent = parent != null && isUIFlowLayoutParentElement(parent);
        placement.layout = roundUILayoutGeometryFields({
            ...placement.layout,
            ...(laidOutByParent ? {} : { x: placement.layout.x + box.x * scaleX, y: placement.layout.y + box.y * scaleY }),
            width: box.width * scaleX,
            height: box.height * scaleY,
        });
    }

    delete component.elements[container.id];
    component.elements[elementId] = {
        ...element,
        parentId: null,
        layout: roundUILayoutGeometryFields({ ...element.layout, x: 0, y: 0 }),
    };
    component.rootElementId = elementId;
    component.previewMeta = { ...(component.previewMeta ?? {}), width: Math.max(1, box.width), height: Math.max(1, box.height) };
    return true;
}

/**
 * Put `wrapper` - an empty container - around the definition's root, as the new root.
 *
 * The container takes the root's size and the root sits in it at its corner, so the definition draws
 * exactly as before and no placement changes.
 */
export function wrapComponentRootInContainer(component: UIComponentDefinition, wrapper: UIElement): void {
    const root = component.elements[component.rootElementId];
    if (!root) {
        return;
    }
    const box = drawnBox(root.layout);
    component.elements[wrapper.id] = {
        ...wrapper,
        parentId: null,
        childrenIds: [root.id],
        layout: roundUILayoutGeometryFields({ ...wrapper.layout, x: 0, y: 0, width: box.width, height: box.height }),
    };
    component.elements[root.id] = {
        ...root,
        parentId: wrapper.id,
        layout: roundUILayoutGeometryFields({ ...root.layout, x: root.layout.x - box.x, y: root.layout.y - box.y }),
    };
    component.rootElementId = wrapper.id;
}
