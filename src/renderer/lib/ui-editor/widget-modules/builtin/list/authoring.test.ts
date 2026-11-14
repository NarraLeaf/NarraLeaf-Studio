import { expect, it } from "vitest";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { UIElement } from "@shared/types/ui-editor/document";
import { createListDockerBarItems } from "./dockerBar";

it("keeps newer list content when the toolbar changes spacing", () => {
    const element: UIElement = {
        id: "list", type: "nl.list", parentId: null, childrenIds: [],
        layout: { x: 0, y: 0, width: 200, height: 200 },
        props: { itemGap: 8, items: [{ title: "Old" }] },
    };
    const document = { elements: { list: element } };
    const documentService = {
        getDocument: () => document,
        updateElementProps: (_id: string, patch: Record<string, unknown>) => {
            const live = document.elements.list;
            live.props = { ...live.props, ...patch };
        },
    } as unknown as UIInspectorData["documentService"];
    const gap = createListDockerBarItems({ element, documentService }).find(item => item.id === "docker-list-item-gap");
    if (!gap || gap.kind !== "number") throw new Error("Missing list spacing control");
    document.elements.list = { ...element, props: { ...element.props, items: [{ title: "New" }] } };

    gap.onChange(16);
    expect(document.elements.list.props).toMatchObject({ itemGap: 16, items: [{ title: "New" }] });
});
