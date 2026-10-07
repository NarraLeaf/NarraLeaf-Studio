import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { blueprintNodeRegistry } from "../ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import type { LintFinding, LintLocation } from "./types";

/**
 * Turning a blueprint location into something an author can tell from its neighbours: the layer the
 * node is in, and the node's own title.
 *
 * A blueprint is named after what it hangs on - a button, a page, the save slot's click area - so
 * every finding in one blueprint carried the same name, and three findings of one rule in it read as
 * one line three times. The layer and the node are what the author sees in the editor's member tree
 * and on the card, so they are what tells the three apart.
 *
 * Resolved by the engine on the way out, once per sweep, for the reason `annotateStoryLocation`
 * gives for row numbers: every rule that files a finding under a node would otherwise have to walk
 * the document for the same two names, and the next rule written would forget to.
 *
 * Both are stored as the document and the node catalogue spell them - the author's layer name, the
 * catalogue's English title - and turned into words when a finding is drawn, because a report
 * outlives the sweep and is read in whatever language the reader has by then.
 */

export type BlueprintNodeLocation = { layerName?: string; nodeTitle?: string };

/** Resolves `(blueprintId, graphId, nodeId)` to the layer's name and the node's catalogue title. */
export type BlueprintNodeLocator = (blueprintId: string, graphId: string | undefined, nodeId: string | undefined) => BlueprintNodeLocation;

function graphOf(document: BlueprintDocument, blueprintId: string, graphId: string): { name?: string; graph?: BlueprintGraphIr } | undefined {
    const graphs = document.blueprints?.[blueprintId]?.graphs;
    if (!graphs) {
        return undefined;
    }
    return graphs.events?.[graphId] ?? graphs.functions?.[graphId] ?? graphs.macros?.[graphId];
}

export function createBlueprintNodeLocator(document: BlueprintDocument | null): BlueprintNodeLocator {
    return (blueprintId, graphId, nodeId) => {
        if (!document || !graphId) {
            return {};
        }
        const slot = graphOf(document, blueprintId, graphId);
        if (!slot) {
            return {};
        }
        const located: BlueprintNodeLocation = {};
        const layerName = slot.name?.trim();
        if (layerName) {
            located.layerName = layerName;
        }
        const node = nodeId ? slot.graph?.nodes?.[nodeId] : undefined;
        // A node type the catalogue does not know (a plugin switched off) has no title to show; its
        // type is an internal id and is left out rather than printed.
        const title = node ? blueprintNodeRegistry.get(node.type)?.displayName : undefined;
        if (title) {
            located.nodeTitle = title;
        }
        return located;
    };
}

/**
 * A finding with its blueprint location's layer and node filled in, or the finding unchanged.
 *
 * Unchanged for every other kind of location, for a location a rule already filled in, and for a
 * graph or node that is not in the document (a context built from one snapshot, a finding held from
 * another): a missing name is left missing rather than guessed.
 */
export function annotateBlueprintLocation<T extends { location: LintLocation }>(finding: T, locate: BlueprintNodeLocator): T {
    const location = finding.location;
    if (location.kind !== "blueprint" || location.layerName !== undefined || location.nodeTitle !== undefined) {
        return finding;
    }
    const resolved = locate(location.blueprintId, location.graphId, location.nodeId);
    if (resolved.layerName === undefined && resolved.nodeTitle === undefined) {
        return finding;
    }
    return { ...finding, location: { ...location, ...resolved } };
}

/** `annotateBlueprintLocation` over a rule's output, for callers holding the document. */
export function annotateBlueprintLocations(document: BlueprintDocument | null, findings: readonly LintFinding[]): LintFinding[] {
    const locate = createBlueprintNodeLocator(document);
    return findings.map(finding => annotateBlueprintLocation(finding, locate));
}
