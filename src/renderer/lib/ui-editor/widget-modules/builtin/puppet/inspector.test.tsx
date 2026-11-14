// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { CustomFieldDefinition, SectionFieldDefinition } from "@/apps/workspace/modules/properties/framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { UIElement } from "@shared/types/ui-editor/document";
import { createPuppetInspector } from "./inspector";

afterEach(cleanup);

it("shows the selected puppet's options after another puppet has an invalid draft", () => {
    const element = (id: string, options: Record<string, unknown>): UIElement => ({
        id, type: "nl.puppet", parentId: null, childrenIds: [],
        layout: { x: 0, y: 0, width: 200, height: 300 }, props: { options },
    });
    const first = element("first", { first: true });
    const second = element("second", { second: true });
    const document = { elements: { first, second } };
    const documentService = {
        getDocument: () => document,
        updateElementProps: (id: string, patch: Record<string, unknown>) => {
            const live = document.elements[id as keyof typeof document.elements];
            live.props = { ...live.props, ...patch };
        },
    } as unknown as UIInspectorData["documentService"];
    const data = (selected: UIElement): UIInspectorData => ({ element: selected, elements: [selected], documentService });
    const schema = createPuppetInspector({ element: first, documentService });
    const sections = schema.tabs![0]!.fields as SectionFieldDefinition<UIInspectorData>[];
    const model = sections.find(section => section.id === "section.puppetModel")!;
    const field = model.fields.find(item => item.id === "puppet.options") as CustomFieldDefinition<UIInspectorData>;
    const Field = field.component;
    const view = render(<Field data={data(first)} onChange={() => {}} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "{invalid" } });
    fireEvent.blur(screen.getByRole("textbox"));
    view.rerender(<Field data={data(second)} onChange={() => {}} />);

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(JSON.stringify({ second: true }, null, 2));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: '{"second":false}' } });
    fireEvent.blur(screen.getByRole("textbox"));
    expect(second.props?.options).toEqual({ second: false });
    expect(first.props?.options).toEqual({ first: true });
});
