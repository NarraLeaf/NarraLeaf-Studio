import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "../BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { mathBlueprintNodes } from "./mathNodes";

describe("reduced built-in blueprint nodes", () => {
    it("registers component init, click, local variable, and math nodes", () => {
        registerCoreBlueprintNodes();

        const types = blueprintNodeRegistry.list().map(def => def.type).sort();

        expect(types).toEqual([
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_CLICK,
            BLUEPRINT_NODE_TYPE_LOCAL_GET,
            BLUEPRINT_NODE_TYPE_LOCAL_SET,
            ...mathBlueprintNodes.map(def => def.type),
        ].sort());
        expect(types).not.toContain(BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT);
        expect(types).not.toContain(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT);
    });

    it("keeps node categories intact for the remaining palette entries", () => {
        registerCoreBlueprintNodes();

        const entries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
            widgetElementType: "nl.button",
        });

        expect(entries.map(entry => [entry.type, entry.category])).toEqual([
            [BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, "Events"],
            [BLUEPRINT_NODE_TYPE_EVENT_HEAD_CLICK, "Events"],
            [BLUEPRINT_NODE_TYPE_LOCAL_GET, "Variables"],
            [BLUEPRINT_NODE_TYPE_LOCAL_SET, "Variables"],
            ...mathBlueprintNodes.map(def => [def.type, "Math"]),
        ]);
    });
});
