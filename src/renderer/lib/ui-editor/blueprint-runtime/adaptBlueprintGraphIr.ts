import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY } from "@shared/types/blueprint/graph";
import type { UIGraph, UIGraphId } from "@shared/types/ui-editor/graph";

/**
 * Map persisted BlueprintGraphIr into UIGraph so GraphExecutor can run it unchanged.
 * Function graphs expose `entries.main` from the Function entry node (IR no longer stores entries).
 */
export function adaptBlueprintGraphIr(ir: BlueprintGraphIr | undefined, graphId: UIGraphId): UIGraph {
    const nodes = ir?.nodes ?? {};
    const fnEntry = Object.entries(nodes).find(([, n]) => n.type === BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY);
    const entries: UIGraph["entries"] = {};
    if (fnEntry) {
        entries.main = { start: { nodeId: fnEntry[0], port: "then" } };
    }
    return {
        id: graphId,
        name: graphId,
        entries,
        nodes,
        edges: ir?.edges ?? [],
        variables: ir?.variables,
        meta: ir?.meta,
    };
}
