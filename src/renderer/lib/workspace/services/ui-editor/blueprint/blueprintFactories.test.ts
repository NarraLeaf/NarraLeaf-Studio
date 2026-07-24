import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_GRAPH_IR_META_KIND,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { createInitialBlueprintDocument, repairGlobalMainIfMissing } from "./blueprintFactories";

function expectDefaultGlobalBlueprint(doc: ReturnType<typeof createInitialBlueprintDocument>) {
    const globalId = doc.ownerRecords.globalMain?.activeBlueprintId;
    expect(globalId).toBeTruthy();

    const blueprint = globalId ? doc.blueprints[globalId] : undefined;
    expect(blueprint?.owner.kind).toBe("globalMain");
    expect(blueprint?.program.kind).toBe("graph");
    if (!blueprint || blueprint.program.kind !== "graph") {
        return;
    }

    const layer = blueprint.program.graphs.events.global;
    expect(layer?.name).toBe("Global");
    expect(layer?.graph?.meta?.[BLUEPRINT_GRAPH_IR_META_KIND]).toBe("event");

    const nodes = layer?.graph?.nodes ?? {};
    expect(nodes["global.appBoot"]?.type).toBe(BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT);
    expect(nodes["global.welcomeText"]?.type).toBe(BLUEPRINT_NODE_TYPE_LITERAL_STRING);
    expect(nodes["global.welcomeText"]?.params?.value).toBe("Hello, World! Welcome to NarraLeaf Studio");
    expect(nodes["global.log"]?.type).toBe(BLUEPRINT_NODE_TYPE_LOG);

    expect(layer?.graph?.edges).toEqual([
        {
            from: { nodeId: "global.appBoot", port: "then" },
            to: { nodeId: "global.log", port: "in" },
        },
        {
            from: { nodeId: "global.welcomeText", port: "value" },
            to: { nodeId: "global.log", port: "value" },
        },
    ]);
}

describe("blueprintFactories", () => {
    it("creates the default global blueprint with a Global app boot log layer", () => {
        expectDefaultGlobalBlueprint(createInitialBlueprintDocument(() => "global-blueprint"));
    });

    it("repairs a missing global blueprint with the same default layer", () => {
        const repaired = repairGlobalMainIfMissing(
            {
                schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
                blueprints: {},
                ownerRecords: {},
                meta: {},
            },
            () => "repaired",
        );
        expectDefaultGlobalBlueprint(repaired);
    });
});
