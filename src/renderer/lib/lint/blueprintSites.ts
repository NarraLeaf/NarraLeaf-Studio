import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { SearchJumpTarget } from "../workspace/services/search/searchIndexModel";

/**
 * Every graph in the project, and how to open one at a given node.
 *
 * One walk, shared by every rule that reads blueprints (`network/fetch-disallowed` and the whole
 * `blueprint` category) and, through the network rule, by `BuildService.runNetworkGate`. Two walks
 * would be two answers to "which graphs does this project actually run", and the one that decides
 * whether a build ships is the one that must not be wrong.
 *
 * Two decisions are load-bearing:
 *
 *  - **A blueprint no owner record points at is skipped.** Owner records are how the runtime
 *    dispatcher resolves a blueprint, so an unlisted one is dead data: it cannot run, and a finding
 *    against it would be a defect the player can never meet. It is also unreachable in the editor,
 *    so the row would not navigate anywhere.
 *  - **Macros are walked.** Nothing populates `graphs.macros` today, but half a dozen walkers read
 *    it defensively and a node buried in one would ship exactly like a node on an event. Costing
 *    nothing while the record is empty is the cheapest way to not be the walker that forgot.
 */

export type BlueprintGraphKind = "event" | "function" | "macro";

export type BlueprintGraphSite = {
    blueprintId: string;
    blueprintName: string;
    /** Stable owner key, as `ownerRecords` spells it - what the editor navigates by. */
    ownerKey: string;
    graphKind: BlueprintGraphKind;
    graphId: string;
    ir: BlueprintGraphIr;
};

export function listBlueprintGraphSites(document: BlueprintDocument | null): BlueprintGraphSite[] {
    if (!document) {
        return [];
    }

    // blueprintId -> ownerKey. The active blueprint is listed first so it wins over the historical
    // revisions kept beside it in the same record.
    const ownerKeyByBlueprintId = new Map<string, string>();
    for (const [ownerKey, record] of Object.entries(document.ownerRecords ?? {})) {
        for (const blueprintId of [record.activeBlueprintId, ...(record.privateBlueprintIds ?? [])]) {
            if (blueprintId && !ownerKeyByBlueprintId.has(blueprintId)) {
                ownerKeyByBlueprintId.set(blueprintId, ownerKey);
            }
        }
    }

    const sites: BlueprintGraphSite[] = [];
    for (const blueprint of Object.values(document.blueprints ?? {})) {
        const ownerKey = ownerKeyByBlueprintId.get(blueprint.id);
        if (!ownerKey || blueprint.program.kind !== "graph") {
            continue;
        }
        const graphs = blueprint.program.graphs;
        const slots: readonly { graphKind: BlueprintGraphKind; entries: Record<string, { graph?: BlueprintGraphIr }> }[] = [
            { graphKind: "event", entries: graphs.events ?? {} },
            { graphKind: "function", entries: graphs.functions ?? {} },
            { graphKind: "macro", entries: graphs.macros ?? {} },
        ];
        for (const { graphKind, entries } of slots) {
            for (const [graphId, slot] of Object.entries(entries)) {
                sites.push({
                    blueprintId: blueprint.id,
                    blueprintName: blueprint.name,
                    ownerKey,
                    graphKind,
                    graphId,
                    ir: slot?.graph ?? {},
                });
            }
        }
    }
    return sites;
}

/**
 * The deep link that opens a site's graph with one node focused.
 *
 * Always produced, never withheld: a finding is worth reporting even when it cannot be navigated to,
 * and the alternative - dropping the site - would quietly narrow what the build gate refuses. The
 * one owner kind whose key `parseBlueprintOwnerKey` cannot read is `sharedAsset`, which has no
 * editor route at all; a row for one is clickable and does nothing, which is the lesser fault.
 */
export function blueprintNodeJumpTarget(site: BlueprintGraphSite, nodeId: string): SearchJumpTarget {
    return {
        kind: "blueprint",
        blueprintId: site.blueprintId,
        ownerKey: site.ownerKey,
        focusNodeId: nodeId,
        ...(site.graphKind === "event" ? { focusEventId: site.graphId } : {}),
        ...(site.graphKind === "function" ? { focusFunctionId: site.graphId } : {}),
    };
}
