/**
 * Finding the Move Mouse nodes in a project.
 *
 * Not a lint rule. Holding one of these nodes is not a defect - it is the point of the feature -
 * and the only thing worth saying about it is conditional on something lint does not know: which
 * platforms this build is for. So the sweep lives here on its own and the build gate reads it,
 * which also leaves one implementation of "does this project move the cursor" for a lint rule to
 * share if one is ever wanted.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO,
    BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO_ELEMENT,
} from "@shared/types/blueprint/graph";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { listBlueprintGraphSites } from "../blueprintSites";

const POINTER_NODE_TYPES: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO,
    BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO_ELEMENT,
]);

export type BlueprintPointerNodeSite = {
    blueprintId: string;
    blueprintName: string;
    graphId: string;
    nodeId: string;
    nodeType: string;
};

/**
 * Every Move Mouse node in the document, wherever it lives.
 *
 * Events, functions and macros - the walk is `listBlueprintGraphSites`, shared with every other
 * blueprint sweep, because a node buried in a macro ships exactly like one on an event.
 */
export function collectBlueprintPointerNodes(document: BlueprintDocument | null): BlueprintPointerNodeSite[] {
    const sites: BlueprintPointerNodeSite[] = [];
    for (const site of listBlueprintGraphSites(document)) {
        for (const node of Object.values(site.ir.nodes ?? {})) {
            if (!POINTER_NODE_TYPES.has(node.type)) {
                continue;
            }
            sites.push({
                blueprintId: site.blueprintId,
                blueprintName: site.blueprintName,
                graphId: site.graphId,
                nodeId: node.id,
                nodeType: node.type,
            });
        }
    }
    return sites;
}
