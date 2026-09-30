/**
 * The document a component definition is drawn against.
 *
 * A definition's elements belong to no page, so a placement draws them as a surface of their own -
 * the one `buildUIComponentSurfaceId` names - rooted at the definition's root. That surface and those
 * elements are *added* to the project's document rather than swapped in for it: everything a widget
 * inside the definition looks up by id still lives in the project's document - a struct describing a
 * list's rows, another component the definition places, and the page a Page widget draws.
 *
 * The view used to hold the component's surface and nothing else. A list or a nested placement never
 * noticed, because structs and components were carried across with the rest of the document; a Page
 * widget did, because pages are surfaces. It asked the view for its page, found nothing, and drew
 * "Missing Page" - in the editor, in Dev Mode and in a shipped game - while the same widget on a page
 * drew perfectly.
 *
 * One construction for everything that draws a definition: the element tree drawing a placement, and
 * the previews of a definition on its own.
 *
 * Comments in English per project convention.
 */

import { buildUIComponentSurfaceId } from "./componentInstanceKey";
import type { UIComponentDefinition, UIDocument, UIElement, UISurface } from "./document";

export type UIComponentDocumentView = {
    /** The surface the definition is drawn as, sized to the definition's root. */
    surface: UISurface;
    /** The definition's root as that surface's root: no parent, at the surface's origin. */
    root: UIElement;
    /** The project's document with the surface and the definition's elements added. */
    document: UIDocument;
};

/** The view of `document` that draws `component`, or null when the definition has lost its root. */
export function buildUIComponentDocumentView(
    document: UIDocument,
    component: UIComponentDefinition,
): UIComponentDocumentView | null {
    const root = component.elements[component.rootElementId];
    if (!root) {
        return null;
    }
    const surface: UISurface = {
        id: buildUIComponentSurfaceId(component.id),
        name: component.name,
        host: "app",
        kind: "appSurface",
        designSize: {
            width: Math.max(1, Math.abs(root.layout.width)),
            height: Math.max(1, Math.abs(root.layout.height)),
        },
        rootElementId: root.id,
    };
    // A snapshot rather than the record: it is placed differently from the record (no parent, at the
    // origin), and whatever draws it may hold on to what it was given.
    const rootSnapshot: UIElement = {
        ...root,
        parentId: null,
        childrenIds: [...root.childrenIds],
        layout: { ...root.layout, x: 0, y: 0 },
        props: root.props ? { ...root.props } : undefined,
        style: root.style ? { ...root.style } : undefined,
        valueBindings: root.valueBindings ? { ...root.valueBindings } : undefined,
        extra: root.extra ? { ...root.extra } : undefined,
    };
    return {
        surface,
        root: rootSnapshot,
        document: {
            ...document,
            // The definition's own surface first, then every surface the project has - which is
            // where the page a Page widget inside the definition names is found.
            surfaces: [surface, ...document.surfaces.filter(item => item.id !== surface.id)],
            elements: {
                ...document.elements,
                ...component.elements,
                [root.id]: rootSnapshot,
            },
        },
    };
}
