import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { isLinkedUIComponentElement } from "@shared/types/ui-editor/document";
import { translate } from "@/lib/i18n";
import { parentTakesNewElement } from "@/lib/ui-editor/tree/resolveAddTarget";
import { resolveSurfaceInsertRefusal } from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";

/**
 * The hover text of an insert entry greyed out because `element` takes no new element, or null when
 * it takes one.
 *
 * Shared by every entry that inserts into a named place - the layer outline's Insert Child on a row,
 * Insert on the outline's blank area and on the canvas, the insert bar - so they grey out together
 * and say the same thing. They used to stay live and do nothing: the insert was refused below them,
 * and the author saw no element and no reason.
 */
export function describeInsertRefusal(document: UIDocument, element: UIElement): string | null {
    if (parentTakesNewElement(document, element)) {
        return null;
    }
    if (isLinkedUIComponentElement(element)) {
        return translate("uiEditor.contextMenu.linkedInstanceContents");
    }
    const name = widgetModuleRegistry.get(element.type)?.displayName ?? element.type;
    return translate("uiEditor.contextMenu.cannotHoldChildren", { name });
}

/** {@link describeInsertRefusal} for the surface as a whole: why nothing can be inserted on it, or null. */
export function describeSurfaceInsertRefusal(document: UIDocument, surfaceId: string): string | null {
    const refusing = resolveSurfaceInsertRefusal(document, surfaceId);
    return refusing ? describeInsertRefusal(document, refusing) : null;
}
