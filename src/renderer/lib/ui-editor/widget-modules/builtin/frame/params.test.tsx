// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { CustomFieldDefinition } from "@/apps/workspace/modules/properties/framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { createFrameInspector } from "./inspector";

afterEach(cleanup);

it("preserves another parameter changed while the frame inspector was open", () => {
    const document: UIDocument = {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [{
            id: "target", name: "Target", kind: "appSurface", host: "app",
            rootElementId: "root", designSize: { width: 200, height: 100 },
            params: [
                { id: "flag", name: "flag", type: "boolean" },
                { id: "message", name: "message", type: "string" },
            ],
        }],
        elements: {
            frame: {
                id: "frame", type: "nl.frame", parentId: null, childrenIds: [],
                layout: { x: 0, y: 0, width: 200, height: 100 },
                props: { targetSurfaceId: "target", params: { flag: false, message: "Old words" } },
            },
        },
    };
    const element = document.elements.frame!;
    const documentService = {
        getDocument: () => document,
        getPageDocument: () => document,
        updateElementProps: (id: string, patch: Record<string, unknown>) => {
            const live = document.elements[id]!;
            live.props = { ...live.props, ...patch };
        },
    } as unknown as UIInspectorData["documentService"];
    const data: UIInspectorData = { element, elements: [element], documentService };
    const schema = createFrameInspector({ element, documentService });
    const field = schema.tabs![0]!.fields.find(item => item.id === "frame.pageParams") as CustomFieldDefinition<UIInspectorData>;
    const Field = field.component;
    render(<Field data={data} onChange={() => {}} />);

    document.elements.frame = {
        ...element,
        props: { ...element.props, params: { flag: false, message: "New words" } },
    };
    fireEvent.click(screen.getByRole("switch", { name: "flag" }));
    expect(document.elements.frame.props?.params).toEqual({ flag: true, message: "New words" });
});
