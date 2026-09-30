import type { Blueprint, BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { registerBuiltInPluginBlueprintNodes } from "@/lib/blueprint-cli/builtinPluginNodes";
import { ownerRefToIndexKey } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import { createAssetNameDescriber } from "./assetNameCatalog";
import { findAssetNameGaps, type AssetNameProject } from "./assetNameGaps";

/**
 * Small builders for the asset-name tests: a graph from node and edge lists, a blueprint, a document
 * whose owner records point at its blueprints, and an interface document. Test-only; nothing ships
 * with it.
 */

export type NodeSpec = { id: string; type: string; params?: Record<string, unknown> };
export type EdgeSpec = [from: string, fromPort: string, to: string, toPort: string];

/** The shipping catalogue, with the built-in plugins' nodes in it the way a Studio has them. */
export function shippingRegistry() {
    registerCoreBlueprintNodes();
    registerBuiltInPluginBlueprintNodes();
    return blueprintNodeRegistry;
}

export function gapsOf(project: AssetNameProject) {
    return findAssetNameGaps(project, createAssetNameDescriber(shippingRegistry()));
}

export function graph(nodes: NodeSpec[], edges: EdgeSpec[]) {
    return {
        graph: {
            nodes: Object.fromEntries(nodes.map(node => [node.id, { params: {}, ...node }])),
            edges: edges.map(([from, fromPort, to, toPort]) => ({
                from: { nodeId: from, port: fromPort },
                to: { nodeId: to, port: toPort },
            })),
        },
    };
}

export function blueprint(
    id: string,
    name: string,
    owner: BlueprintOwnerRef,
    events: Record<string, ReturnType<typeof graph>>,
    extra: Record<string, unknown> = {},
): Blueprint {
    return { id, name, owner, graphs: { events, functions: {} }, ...extra } as unknown as Blueprint;
}

export function document(...blueprints: Blueprint[]): BlueprintDocument {
    return {
        ownerRecords: Object.fromEntries(blueprints.map(bp => [ownerRefToIndexKey(bp.owner), { blueprintId: bp.id }])),
        blueprints: Object.fromEntries(blueprints.map(bp => [bp.id, bp])),
    } as unknown as BlueprintDocument;
}

export function element(id: string, type: string, parentId: string | null, extra: Partial<UIElement> = {}): UIElement {
    return { id, type, name: id, parentId, childrenIds: [], layout: {}, props: {}, ...extra } as unknown as UIElement;
}

export function interfaceOf(surface: { id: string; name: string; rootElementId: string }, elements: UIElement[]): UIDocument {
    return {
        surfaces: [surface],
        elements: Object.fromEntries(elements.map(entry => [entry.id, entry])),
    } as unknown as UIDocument;
}
