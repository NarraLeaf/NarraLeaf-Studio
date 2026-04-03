import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { UIGraph, UIGraphId } from "@shared/types/ui-editor/graph";

/**
 * Map persisted BlueprintGraphIr into UIGraph so GraphExecutor can run it unchanged.
 */
export function adaptBlueprintGraphIr(ir: BlueprintGraphIr | undefined, graphId: UIGraphId): UIGraph {
    return {
        id: graphId,
        name: graphId,
        entries: ir?.entries ?? {},
        nodes: ir?.nodes ?? {},
        edges: ir?.edges ?? [],
        variables: ir?.variables,
        meta: ir?.meta,
    };
}
