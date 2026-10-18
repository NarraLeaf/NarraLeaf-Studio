import { describe, expect, it } from "vitest";
import type { UIElementId, UISurfaceId } from "@shared/types/ui-editor/document";
import { blueprintTargetKeepingLayer, type BlueprintEntryTabPayload } from "./blueprintEntryTabId";

describe("blueprintTargetKeepingLayer", () => {
    const owner: BlueprintEntryTabPayload = {
        blueprintId: "bp",
        ownerKind: "widgetMain",
        surfaceId: "title" as UISurfaceId,
        elementId: "start" as UIElementId,
    };

    it("opens the same owner under the given title on the event layer that was open", () => {
        expect(blueprintTargetKeepingLayer({ ...owner, focusEventId: "second" }, "Start")).toEqual({
            blueprintId: "bp",
            ownerKind: "widgetMain",
            surfaceId: "title",
            componentId: undefined,
            elementId: "start",
            propPath: undefined,
            title: "Start",
            focusEventId: "second",
        });
    });

    it("keeps a function layer the same way", () => {
        const target = blueprintTargetKeepingLayer({ ...owner, focusFunctionId: "helper" }, "Start");
        expect(target.focusFunctionId).toBe("helper");
        expect(target.focusEventId).toBeUndefined();
    });

    it("does not repeat a request to bring a node or a field into view", () => {
        const target = blueprintTargetKeepingLayer(
            { ...owner, focusEventId: "second", focusNodeId: "node", focusFieldId: "field" },
            "Start",
        );
        expect(target).not.toHaveProperty("focusNodeId");
        expect(target).not.toHaveProperty("focusFieldId");
    });
});
