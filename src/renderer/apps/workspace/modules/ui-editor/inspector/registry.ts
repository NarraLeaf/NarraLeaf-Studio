import type { PropertyEditorSchema } from "@/apps/workspace/modules/properties/framework/types";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";

export type { UIInspectorData };

/**
 * Resolves the property inspector schema for a given element.
 * Delegates to the widget module's `createInspector` method.
 */
export function getElementInspector(
    element: UIElement,
    documentService: UIDocumentService
): PropertyEditorSchema<UIInspectorData> | undefined {
    const mod = widgetModuleRegistry.get(element.type);
    if (!mod?.createInspector) {
        return undefined;
    }
    return mod.createInspector({ element, documentService });
}
