/**
 * Finding the nodes in a project that only do anything on a desktop build.
 *
 * Not lint rules. Holding one of these nodes is not a defect - it is the point of the feature - and
 * the only thing worth saying about it is conditional on something lint does not know: which
 * platforms this build is for. So the sweeps live here on their own and the build gate reads them,
 * which also leaves one implementation of "does this project move the cursor" and "does it take
 * screenshots" for a lint rule to share if one is ever wanted.
 *
 * Two families so far, and they are the same shape twice: the node exists on every host, the web
 * export answers it honestly as unsupported, and the author's own `Failed` branch is what runs
 * there. What the build adds is telling them before they ship rather than after.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_APP_OPEN_SCREENSHOTS_FOLDER,
    BLUEPRINT_NODE_TYPE_APP_SAVE_SCREENSHOT,
    BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO,
    BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO_ELEMENT,
} from "@shared/types/blueprint/graph";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { listBlueprintGraphSites } from "../blueprintSites";

const POINTER_NODE_TYPES: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO,
    BLUEPRINT_NODE_TYPE_POINTER_MOVE_TO_ELEMENT,
]);

const SCREENSHOT_NODE_TYPES: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_APP_SAVE_SCREENSHOT,
    BLUEPRINT_NODE_TYPE_APP_OPEN_SCREENSHOTS_FOLDER,
]);

export type BlueprintPointerNodeSite = {
    blueprintId: string;
    blueprintName: string;
    graphId: string;
    nodeId: string;
    nodeType: string;
};

/**
 * Every node of one family in the document, wherever it lives.
 *
 * Events, functions and macros - the walk is `listBlueprintGraphSites`, shared with every other
 * blueprint sweep, because a node buried in a macro ships exactly like one on an event.
 */
function collectNodesOfTypes(
    document: BlueprintDocument | null,
    types: ReadonlySet<string>,
): BlueprintPointerNodeSite[] {
    const sites: BlueprintPointerNodeSite[] = [];
    for (const site of listBlueprintGraphSites(document)) {
        for (const node of Object.values(site.ir.nodes ?? {})) {
            if (!types.has(node.type)) {
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

/** Every Move Mouse node in the document. */
export function collectBlueprintPointerNodes(document: BlueprintDocument | null): BlueprintPointerNodeSite[] {
    return collectNodesOfTypes(document, POINTER_NODE_TYPES);
}

/** Every Save Screenshot / Open Screenshots Folder node in the document. */
export function collectBlueprintScreenshotNodes(document: BlueprintDocument | null): BlueprintPointerNodeSite[] {
    return collectNodesOfTypes(document, SCREENSHOT_NODE_TYPES);
}
