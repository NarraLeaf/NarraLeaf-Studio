import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { listBlueprintGraphSites } from "@/lib/lint/blueprintSites";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { DLC_OPTIONS_SOURCE } from "@/lib/ui-editor/blueprint-nodes/built-in/dlcNodes";

/**
 * How many graph nodes name `dlcId` in a field whose options are the project's DLC.
 *
 * Read off each node's declared options source rather than off one node type, the same way
 * `blueprint/reference-missing` finds the fields it checks, so a node added later that picks a DLC
 * is counted without anybody remembering to list it here.
 *
 * The graphs walked are the ones the game runs (`listBlueprintGraphSites`), so a blueprint no page
 * or widget owns any more does not make a DLC look used.
 */
export function countDlcGraphReferences(document: BlueprintDocument | null, dlcId: string): number {
    const id = dlcId.trim();
    if (!document || !id) {
        return 0;
    }
    registerCoreBlueprintNodes();
    let count = 0;
    for (const site of listBlueprintGraphSites(document)) {
        for (const node of Object.values(site.ir.nodes ?? {})) {
            const params = blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, node.params).inspectorParams ?? [];
            for (const param of params) {
                if (param.dynamicOptionsSource === DLC_OPTIONS_SOURCE
                    && String(node.params?.[param.key] ?? "").trim() === id) {
                    count += 1;
                }
            }
        }
    }
    return count;
}
