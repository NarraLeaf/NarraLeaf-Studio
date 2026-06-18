import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_BLUR,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT,
} from "@shared/types/blueprint/graph";
import {
    createDefaultBlueprintEventLayerValue,
    sortBlueprintEventLayerEntries,
} from "./BlueprintEventLayerDialogContent";

describe("BlueprintEventLayerDialogContent", () => {
    it("orders common event heads by workflow priority instead of label sort", () => {
        const sorted = sortBlueprintEventLayerEntries([
            { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_BLUR, displayName: "Blur" },
            { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, displayName: "Mouse Click" },
            { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, displayName: "Init" },
        ]);

        expect(sorted.map(entry => entry.type)).toEqual([
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_BLUR,
        ]);
    });

    it("defaults the new layer to no event configuration", () => {
        expect(createDefaultBlueprintEventLayerValue([
            { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT, displayName: "Page Event" },
            { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, displayName: "Init" },
        ], "Layer 1")).toEqual({
            name: "Layer 1",
            nodeType: "",
            valid: true,
        });
    });
});
