import { describe, expect, it } from "vitest";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { splitLayoutPatchesForEnteredState } from "./enteredStateLayoutCommit";

function model(offsetX: number, offsetY = 0): AppearanceModel {
    const groups = [
        { key: "transformOffsetX", rows: [{ conditions: null, value: 0 }] },
        { key: "transformOffsetY", rows: [{ conditions: null, value: 0 }] },
    ];
    const onGroups = [
        { key: "transformOffsetX", rows: [{ conditions: null, value: offsetX }] },
        { key: "transformOffsetY", rows: [{ conditions: null, value: offsetY }] },
    ];
    return {
        defaultVariantId: "default",
        variants: [
            { id: "default", name: "Default", propertyGroups: groups },
            { id: "on", name: "On", propertyGroups: onGroups },
        ],
    } as AppearanceModel;
}

function element(id: string, parentId: string | null, appearance?: AppearanceModel): UIElement {
    return {
        id,
        type: "nl.container",
        name: id,
        parentId,
        childrenIds: [],
        layout: { x: 10, y: 20, width: 40, height: 40 },
        props: appearance ? { appearance } : {},
    };
}

function document(elements: UIElement[]): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        surfaces: [],
        elements: Object.fromEntries(elements.map(e => [e.id, e])),
    } as unknown as UIDocument;
}

const offsetOf = (next: AppearanceModel, key: string) =>
    next.variants.find(v => v.id === "on")?.propertyGroups.find(g => g.key === key)?.rows[0]?.value;

describe("splitLayoutPatchesForEnteredState", () => {
    const doc = document([element("switch", null), element("thumb", "switch", model(24))]);

    it("leaves geometry alone while nothing is entered", () => {
        const out = splitLayoutPatchesForEnteredState(doc, null, { thumb: { x: 30 } });

        expect(out.layoutPatches).toEqual({ thumb: { x: 30 } });
        expect(out.appearancePatches).toEqual({});
    });

    it("adds the move to the entered state's offset", () => {
        const out = splitLayoutPatchesForEnteredState(doc, { elementId: "thumb", variantId: "on" }, {
            thumb: { x: 30, y: 25 },
        });

        expect(out.layoutPatches).toEqual({});
        expect(offsetOf(out.appearancePatches.thumb, "transformOffsetX")).toBe(44);
        expect(offsetOf(out.appearancePatches.thumb, "transformOffsetY")).toBe(5);
    });

    it("follows a state entered on an ancestor", () => {
        const out = splitLayoutPatchesForEnteredState(doc, { elementId: "switch", variantId: "on" }, {
            thumb: { x: 14 },
        });

        expect(offsetOf(out.appearancePatches.thumb, "transformOffsetX")).toBe(28);
    });

    it("writes the resting state to the element's own geometry", () => {
        const out = splitLayoutPatchesForEnteredState(doc, { elementId: "switch", variantId: null }, {
            thumb: { x: 30 },
        });

        expect(out.layoutPatches).toEqual({ thumb: { x: 30 } });
        expect(out.appearancePatches).toEqual({});
    });

    it("keeps size with the element and sends only the move to the state", () => {
        const out = splitLayoutPatchesForEnteredState(doc, { elementId: "thumb", variantId: "on" }, {
            thumb: { x: 30, width: 80 },
        });

        expect(out.layoutPatches).toEqual({ thumb: { width: 80 } });
        expect(offsetOf(out.appearancePatches.thumb, "transformOffsetX")).toBe(44);
    });

    it("falls back to geometry for an element that has no such state", () => {
        const plain = document([element("switch", null), element("plain", "switch")]);

        const out = splitLayoutPatchesForEnteredState(plain, { elementId: "switch", variantId: "on" }, {
            plain: { x: 30 },
        });

        expect(out.layoutPatches).toEqual({ plain: { x: 30 } });
    });

    it("ignores an element outside the entered subtree", () => {
        const sibling = document([element("switch", null), element("other", null, model(24))]);

        const out = splitLayoutPatchesForEnteredState(sibling, { elementId: "switch", variantId: "on" }, {
            other: { x: 30 },
        });

        expect(out.layoutPatches).toEqual({ other: { x: 30 } });
    });
});
