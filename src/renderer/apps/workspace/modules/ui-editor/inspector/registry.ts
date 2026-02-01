import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { PropertyEditorSchema } from "@/apps/workspace/modules/properties/framework/types";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";

type ElementInspectorContext = {
    element: UIElement;
    documentService: UIDocumentService;
};

type UIInspectorData = {
    element: UIElement;
    elements: UIElement[];
};

type ElementInspectorFactory = (context: ElementInspectorContext) => PropertyEditorSchema<UIInspectorData>;

const registry = new Map<string, ElementInspectorFactory>();

export function registerElementInspector(type: string, factory: ElementInspectorFactory): void {
    registry.set(type, factory);
}

export function getElementInspector(
    element: UIElement,
    documentService: UIDocumentService
): PropertyEditorSchema<UIInspectorData> | undefined {
    const factory = registry.get(element.type);
    if (!factory) {
        return undefined;
    }
    return factory({ element, documentService });
}

const buttonVariants = [
    { value: "primary", label: "Primary" },
    { value: "secondary", label: "Secondary" },
    { value: "ghost", label: "Ghost" },
    { value: "danger", label: "Danger" },
];

registerElementInspector("nl.button", ({ element, documentService }) =>
    createPropertyEditorSchema<UIInspectorData>({
        id: "ui-inspector:nl.button",
        title: element.name ?? "Button",
        fields: [
            defineField<UIInspectorData, any>({
                id: "props.text",
                type: "text",
                label: "Text",
                getValue: (data: UIInspectorData) => String(data.element.props?.text ?? "Button"),
                setValue: (data: UIInspectorData, value: string) => {
                    const element = data.element;
                    documentService.updateElementProps(element.id, { ...element.props, text: value });
                },
            }),
            defineField<UIInspectorData, any>({
                id: "props.variant",
                type: "select",
                label: "Variant",
                options: buttonVariants,
                getValue: (data: UIInspectorData) => data.element.props?.variant ?? "primary",
                setValue: (data: UIInspectorData, value: string | number) => {
                    const element = data.element;
                    documentService.updateElementProps(element.id, { ...element.props, variant: value });
                },
            }),
        ],
    })
);
