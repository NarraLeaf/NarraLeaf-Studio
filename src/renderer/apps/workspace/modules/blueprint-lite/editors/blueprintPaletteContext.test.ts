import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { resolveWidgetEventLayerSlotsForPalette } from "./blueprintPaletteContext";

function element(input: Partial<UIElement> & Pick<UIElement, "id" | "type">): UIElement {
    return {
        ...input,
        id: input.id,
        type: input.type,
        parentId: input.parentId ?? null,
        childrenIds: input.childrenIds ?? [],
        layout: input.layout ?? { x: 0, y: 0, width: 100, height: 100 },
    };
}

describe("resolveWidgetEventLayerSlotsForPalette", () => {
    it("uses a matching widget event id as the Add Node menu event slot", () => {
        expect(resolveWidgetEventLayerSlotsForPalette({
            ownerKind: "widgetMain",
            widgetElement: element({ id: "list", type: "nl.list" }),
            graphView: { kind: "event", graphId: "scroll" },
            blueprintId: "bp",
            widgetBlueprintEvents: [{ id: "scroll" }],
        })).toEqual(["scroll"]);
    });

    it("prefers explicit UI behavior layer wiring when present", () => {
        expect(resolveWidgetEventLayerSlotsForPalette({
            ownerKind: "widgetMain",
            widgetElement: element({
                id: "list",
                type: "nl.list",
                behavior: {
                    events: {
                        scroll: { kind: "blueprintEvent", blueprintId: "bp", eventId: "custom-layer" },
                    },
                },
            }),
            graphView: { kind: "event", graphId: "custom-layer" },
            blueprintId: "bp",
            widgetBlueprintEvents: [{ id: "scroll" }],
        })).toEqual(["scroll"]);
    });

    it("leaves generic widget layers unrestricted by slot", () => {
        expect(resolveWidgetEventLayerSlotsForPalette({
            ownerKind: "widgetMain",
            widgetElement: element({ id: "button", type: "nl.button" }),
            graphView: { kind: "event", graphId: "custom-layer" },
            blueprintId: "bp",
            widgetBlueprintEvents: [{ id: "mouseClick" }],
        })).toEqual([]);
    });
});
