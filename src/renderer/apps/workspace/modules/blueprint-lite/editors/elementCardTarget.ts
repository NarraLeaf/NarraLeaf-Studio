/**
 * What an Element card on a blueprint canvas draws: the element its reference names, and the
 * surface and document that element is drawn against.
 *
 * A reference on a page's blueprint names that page, and the page and the element are both in the
 * project's document. A reference written inside a component definition's blueprint does not: it
 * names the definition's own surface, which is in no document's surface list, and the element lives
 * in the definition rather than in the document's element table. Looked up the way a page reference
 * is, every Element card on a definition's blueprint found nothing and drew no name and no preview.
 * Such a reference is drawn here the way a placement draws the definition
 * (`buildUIComponentDocumentView`).
 *
 * Two spellings of a definition's surface are in stored blueprints. `buildUIComponentSurfaceId` is the
 * one the runtime compares against and the one the command-line tools write; the element picker
 * writes the component editor's own surface id (`getComponentEditorSurfaceId`), because that is the
 * surface it was picked on. Both name the same tree, so both are read.
 *
 * Comments in English per project convention.
 */

import { buildUIComponentDocumentView, type UIComponentDocumentView } from "@shared/types/ui-editor/componentDocumentView";
import { readUIComponentSurfaceComponentId } from "@shared/types/ui-editor/componentInstanceKey";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { parseComponentEditorSurfaceId } from "@/apps/workspace/modules/ui-editor/editors/componentEditorAdapter";

export type ElementCardTarget = {
    /** The document the element is drawn against. */
    document: UIDocument;
    /** The page the element sits on, or the component definition's own surface. */
    surface: UISurface;
    element: UIElement;
};

export type ElementCardTargetRef = {
    surfaceId: string;
    elementId: string;
};

type ComponentDrawing = {
    /** Which elements are the definition's own, as opposed to the pages' the view also carries. */
    ownElementIds: ReadonlySet<string>;
    document: UIDocument;
    surface: UISurface;
};

/**
 * A resolver for element references against one state of the project's document.
 *
 * Built once per state of the document rather than once per card, and handing out the same objects
 * for as long as it lives: a card's preview is drawn from what it is given, and a fresh copy of a
 * definition's view on every pass would redraw every preview in a definition's blueprint whenever any
 * card on the canvas moved.
 */
export function createElementCardTargetResolver(
    document: UIDocument,
): (ref: ElementCardTargetRef) => ElementCardTarget | null {
    const drawings = new Map<string, ComponentDrawing | null>();
    const componentDrawing = (componentId: string): ComponentDrawing | null => {
        if (!drawings.has(componentId)) {
            const component = document.components?.find(item => item.id === componentId);
            const view = component ? buildUIComponentDocumentView(document, component) : null;
            drawings.set(
                componentId,
                component && view
                    ? {
                          ownElementIds: new Set(Object.keys(component.elements)),
                          document: view.document,
                          surface: definitionSurface(view),
                      }
                    : null,
            );
        }
        return drawings.get(componentId) ?? null;
    };

    return ref => {
        const componentId =
            readUIComponentSurfaceComponentId(ref.surfaceId) ?? parseComponentEditorSurfaceId(ref.surfaceId);
        if (componentId) {
            const drawing = componentDrawing(componentId);
            // Only the definition's own elements: the view also carries every page's elements, and a
            // reference into a definition that names one of those is not pointing at anything in it.
            const element = drawing?.ownElementIds.has(ref.elementId)
                ? drawing.document.elements[ref.elementId]
                : undefined;
            return drawing && element ? { document: drawing.document, surface: drawing.surface, element } : null;
        }
        const surface = document.surfaces.find(item => item.id === ref.surfaceId);
        const element = document.elements[ref.elementId];
        return surface && element ? { document, surface, element } : null;
    };
}

/**
 * The definition's surface as a thumbnail draws it.
 *
 * A definition has no background of its own: a placement draws it over whatever page it is put on,
 * and the component editor draws it over nothing. Left to the page default, a thumbnail would put a
 * white field behind it that no placement has.
 */
function definitionSurface(view: UIComponentDocumentView): UISurface {
    return { ...view.surface, settings: { ...view.surface.settings, backgroundColor: "transparent" } };
}
