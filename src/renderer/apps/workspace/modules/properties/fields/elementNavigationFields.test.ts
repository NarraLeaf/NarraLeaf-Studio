import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { createElementNavigationField } from "./elementNavigationFields";

const t = ((key: string) => key) as any;

function element(id: string, type: string, parentId: string | null): UIElement {
    return { id, type, parentId, childrenIds: [], layout: { x: 0, y: 0, width: 100, height: 40 } } as UIElement;
}

describe("createElementNavigationField", () => {
    it("carries the navigation settings topic, as a page's Navigation section does", () => {
        const field = createElementNavigationField(element("start", "nl.button", "root"), t) as { helpTopic?: string } | null;
        expect(field?.helpTopic).toBe("focusNavigationSettings");
    });

    it("gives a surface's root no section: where the focus starts is the surface's own setting", () => {
        expect(createElementNavigationField(element("root", "nl.root", null), t)).toBeNull();
    });
});
