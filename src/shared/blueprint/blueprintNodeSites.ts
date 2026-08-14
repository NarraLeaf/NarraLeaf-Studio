/**
 * Where a given kind of node sits in a blueprint document.
 *
 * Several checks need the same answer - "does this project use node X, and where" - and each one
 * that walks the document itself is another walker that can forget a graph slot. The fold walkers
 * next door learned this the expensive way: a node buried in a macro ships exactly like a node on an
 * event, so a walker that only reads `graphs.events` is wrong in a way no test notices until
 * somebody authors a macro.
 *
 * Reports a site per node, never a count: every caller so far wants to name the blueprint the author
 * has to go and open.
 *
 * Comments in English per project convention.
 */

import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";

export type BlueprintNodeSite = {
    blueprintId: string;
    /** The blueprint's authored name, or its id when it has none. What a message shows. */
    blueprintName: string;
    /** The graph the node sits on, named as the author named it. Blank when the graph has no name. */
    graphName: string;
    nodeId: string;
    nodeType: string;
};

/** Every node of one of `nodeTypes` in this blueprint, across events, functions and macros. */
export function collectBlueprintNodeSitesIn(
    blueprint: Blueprint,
    nodeTypes: ReadonlySet<string>,
): BlueprintNodeSite[] {
    if (blueprint.program.kind !== "graph") {
        return [];
    }
    const graphs = blueprint.program.graphs;
    const carriers = [
        ...Object.values(graphs.events ?? {}),
        ...Object.values(graphs.functions ?? {}),
        ...Object.values(graphs.macros ?? {}),
    ];
    const sites: BlueprintNodeSite[] = [];
    for (const carrier of carriers) {
        for (const node of Object.values(carrier.graph?.nodes ?? {})) {
            if (!nodeTypes.has(node.type)) {
                continue;
            }
            sites.push({
                blueprintId: blueprint.id,
                blueprintName: blueprint.name || blueprint.id,
                graphName: carrier.name ?? "",
                nodeId: node.id,
                nodeType: node.type,
            });
        }
    }
    return sites;
}

/** The same walk over every blueprint a document holds. */
export function collectBlueprintNodeSites(
    document: BlueprintDocument | null | undefined,
    nodeTypes: ReadonlySet<string>,
): BlueprintNodeSite[] {
    return Object.values(document?.blueprints ?? {})
        .flatMap(blueprint => collectBlueprintNodeSitesIn(blueprint, nodeTypes));
}
