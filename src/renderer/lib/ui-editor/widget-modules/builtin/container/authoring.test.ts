import { describe, expect, it } from "vitest";
import type { SectionFieldDefinition, SelectFieldDefinition } from "@/apps/workspace/modules/properties/framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { UIElement } from "@shared/types/ui-editor/document";
import { createContainerDockerBarItems } from "./dockerBar";
import { createContainerInspector } from "./inspector";

function authoring() {
    const element: UIElement = {
        id: "container", type: "nl.container", parentId: null, childrenIds: [],
        layout: { x: 0, y: 0, width: 200, height: 100 },
        props: { layoutKind: "stack", stackGap: 4, stackDirection: "vertical" },
    };
    const document = { elements: { container: element } };
    const documentService = {
        getDocument: () => document,
        updateElementProps: (_id: string, patch: Record<string, unknown>) => {
            const live = document.elements.container;
            live.props = { ...live.props, ...patch };
        },
    } as unknown as UIInspectorData["documentService"];
    const data: UIInspectorData = { element, elements: [element], documentService };
    return { document, element, documentService, data };
}

describe("container layout edits", () => {
    it("preserves newer properties when an older inspector changes layout mode", () => {
        const { document, element, documentService, data } = authoring();
        const schema = createContainerInspector({ element, documentService });
        const section = schema.tabs![0]!.fields.find(field => field.id === "section.containerLayout") as SectionFieldDefinition<UIInspectorData>;
        const mode = section.fields.find(field => field.id === "container.layoutKind") as SelectFieldDefinition<UIInspectorData>;
        document.elements.container = { ...element, props: { ...element.props, stackGap: 12 } };

        mode.setValue!(data, "scroll");
        expect(document.elements.container.props).toMatchObject({ layoutKind: "scroll", stackGap: 12 });
    });

    it("preserves newer properties when an older toolbar changes spacing", () => {
        const { document, element, documentService } = authoring();
        const gap = createContainerDockerBarItems({ element, documentService }).find(item => item.id === "docker-container-stack-gap");
        if (!gap || gap.kind !== "number") throw new Error("Missing container spacing control");
        document.elements.container = { ...element, props: { ...element.props, stackDirection: "horizontal" } };

        gap.onChange(10);
        expect(document.elements.container.props).toMatchObject({ stackGap: 10, stackDirection: "horizontal" });
    });
});
