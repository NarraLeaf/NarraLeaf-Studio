import { describe, expect, it } from "vitest";
import { Columns2, Component, Rows2, Square } from "lucide-react";
import type { UIElement } from "@shared/types/ui-editor/document";
import { resolveOutlineRowIcon } from "./LayerOutlineRows";

function element(type: string, props: Record<string, unknown> = {}, extra?: Record<string, unknown>): UIElement {
    return { id: "e", type, parentId: "root", childrenIds: [], props, extra, layout: { x: 0, y: 0, width: 10, height: 10 } } as UIElement;
}

describe("resolveOutlineRowIcon", () => {
    it("shows the direction a stack or scroll container lays its children out in", () => {
        expect(resolveOutlineRowIcon(element("nl.container", { layoutKind: "stack" })).icon).toBe(Rows2);
        expect(resolveOutlineRowIcon(element("nl.container", { layoutKind: "scroll", stackDirection: "horizontal" })).icon).toBe(Columns2);
    });

    it("marks a linked component instance with the component glyph, in the accent colour", () => {
        expect(resolveOutlineRowIcon(element("nl.container", {}, { componentLink: { componentId: "c", linked: true } }))).toEqual({
            icon: Component,
            component: true,
        });
    });

    it("falls back to a plain square for a widget the registry does not know", () => {
        expect(resolveOutlineRowIcon(element("plugin.unknown")).icon).toBe(Square);
    });
});
