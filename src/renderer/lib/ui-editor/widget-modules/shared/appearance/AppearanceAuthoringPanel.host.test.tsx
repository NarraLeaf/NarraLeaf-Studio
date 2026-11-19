// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { Circle } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { UIElement } from "@shared/types/ui-editor/document";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { AppearanceAuthoringPanel } from "./AppearanceAuthoringPanel";

vi.mock("@/lib/ui-editor/hooks/useEnteredElementState", () => ({
    useEditorEnteredState: () => ({ surfaceId: "page", elementId: "host", variantId: "on" }),
}));
vi.mock("./compact/CompactTextAppearance", () => ({
    CompactTextAppearance: ({ variant }: { variant: { id: string } }) => <span>{variant.id}</span>,
}));

const appearance: AppearanceModel = {
    defaultVariantId: "default",
    variants: [
        { id: "default", name: "Default", propertyGroups: [] },
        { id: "on", name: "On", propertyGroups: [] },
    ],
};

afterEach(cleanup);

describe("appearance state ownership", () => {
    it("follows the new state host when the selected element is reparented", () => {
        widgetModuleRegistry.register({
            type: "test.state-host",
            displayName: "Host",
            icon: Circle,
            createDefaultElement: () => ({}),
            listEditorStates: () => [{ id: null, name: "Off" }, { id: "on", name: "On" }],
            render: () => null,
        });
        const element = {
            id: "text", type: "nl.text", parentId: "root", childrenIds: [],
            layout: { x: 0, y: 0, width: 100, height: 20 }, props: { appearance },
        } as UIElement;
        const host = { ...element, id: "host", type: "test.state-host", parentId: "root" };
        const document = { elements: { text: element, host }, components: [] };
        const documentService = { getDocument: () => document };
        const panel = () => (
            <AppearanceAuthoringPanel kind="text" appearance={appearance} onReplace={() => undefined}
                inspectorData={{ element, elements: [element], documentService: documentService as never }}
                draftResetKey={element.id} />
        );

        const view = render(panel());
        expect(screen.getByText("default")).toBeTruthy();
        element.parentId = "host";
        view.rerender(panel());
        expect(screen.getByText("on")).toBeTruthy();
        element.parentId = "root";
        view.rerender(panel());
        expect(screen.getByText("default")).toBeTruthy();
    });
});
