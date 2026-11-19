import { describe, expect, it } from "vitest";
import type { SectionFieldDefinition, SelectFieldDefinition } from "@/apps/workspace/modules/properties/framework/types";
import { resolveButtonVisualProps } from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { ButtonWidgetDeclaration } from "../button.declaration";
import { createButtonDockerBarItems } from "./dockerBar";
import { createButtonInspector } from "./inspector";

function authoring() {
    const inserted = ButtonWidgetDeclaration.createDefaultElement();
    const element = { ...inserted, id: "button", parentId: null, childrenIds: [] } as UIInspectorData["element"];
    const document = { elements: { button: element } };
    const documentService = {
        getDocument: () => document,
        updateElementProps: (_id: string, patch: Record<string, unknown>) => {
            const live = document.elements.button;
            live.props = { ...live.props, ...patch };
        },
    } as unknown as UIInspectorData["documentService"];
    const data: UIInspectorData = { element, elements: [element], documentService };
    const visual = () => {
        const live = document.elements.button;
        return resolveButtonVisualProps(live, live.props?.appearance as Parameters<typeof resolveButtonVisualProps>[1], {
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        });
    };
    return { document, element, documentService, data, visual };
}

describe("button typography and spacing edits", () => {
    it("draws the weight chosen in the inspector", () => {
        const { element, documentService, data, visual } = authoring();
        const schema = createButtonInspector({ element, documentService });
        const sections = schema.tabs![0]!.fields as SectionFieldDefinition<UIInspectorData>[];
        const text = sections.find(section => section.id === "section.buttonText")!;
        const typography = text.fields.find(field => field.id === "section.buttonTypography") as SectionFieldDefinition<UIInspectorData>;
        const weight = typography.fields.find(field => field.id === "button.weight") as SelectFieldDefinition<UIInspectorData>;

        weight.setValue!(data, "bold");
        expect(visual().fontWeight).toBe("bold");
    });

    it("draws the spacing chosen in the toolbar and keeps a later label edit", () => {
        const { document, element, documentService, visual } = authoring();
        const item = createButtonDockerBarItems({ element, documentService }).find(entry => entry.id === "docker-button-pad-x");
        if (!item || item.kind !== "number") throw new Error("Missing button padding control");
        document.elements.button = { ...element, props: { ...element.props, label: "Updated label" } };

        item.onChange(24);
        expect(visual().paddingX).toBe(24);
        expect(document.elements.button.props?.label).toBe("Updated label");
    });
});
