import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NULL,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
} from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "../BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";

describe("structural blueprint nodes", () => {
    it("offers typed literal nodes in the Data palette and hides the legacy generic literal", () => {
        registerCoreBlueprintNodes();

        const entries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "surfaceMain", surfaceId: "surface" },
        });
        const dataTypes = entries.filter(e => e.category === "Data").map(e => e.type);

        expect(dataTypes).toContain(BLUEPRINT_NODE_TYPE_LITERAL_STRING);
        expect(dataTypes).toContain(BLUEPRINT_NODE_TYPE_LITERAL_NUMBER);
        expect(dataTypes).toContain(BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN);
        expect(dataTypes).toContain(BLUEPRINT_NODE_TYPE_LITERAL_NULL);
        expect(dataTypes).toContain(BLUEPRINT_NODE_TYPE_LITERAL_JSON);
        expect(dataTypes).not.toContain(BLUEPRINT_NODE_TYPE_LITERAL);
    });
});
