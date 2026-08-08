import {
    BLUEPRINT_NODE_TYPE_NETWORK_FETCH,
    BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_JSON,
    BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_TEXT,
} from "@shared/types/blueprint/graph";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { SearchJumpTarget } from "../../workspace/services/search/searchIndexModel";
import type { LintContext } from "../context";
import type { LintFinding, LintRule } from "../types";

/**
 * `network` - whether the project's blueprints ask for something its settings forbid.
 *
 * One rule, and it exists because of an asymmetry the other categories do not have: a network node
 * in a project with Allow HTTP off is not a style opinion or a probable mistake, it is code that
 * **provably cannot run**. The shipped game confines the renderer to its own protocol and cancels
 * every HTTP request (`runtime/main/networkPolicy.ts`), and the host refuses the request before it
 * is made. The node is dead, and nothing an author does at runtime revives it.
 *
 * That is why this defaults to `error` and why the build has a gate of its own rather than relying
 * on this rule. Lint is switchable - `runOnBuild` turns the sweep off and a severity can be set to
 * `off` - so it can inform an author but must not be the only thing standing between a project and
 * a build that ships dead graphs. See `BuildService.runNetworkGate`, which is unconditional for the
 * same reason the media gate is.
 */

const NETWORK_NODE_TYPES: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_NETWORK_FETCH,
    BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_TEXT,
    BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_JSON,
]);

export type BlueprintNetworkNodeSite = {
    blueprintId: string;
    blueprintName: string;
    graphId: string;
    nodeId: string;
    nodeType: string;
    target: SearchJumpTarget;
};

/**
 * Every network node in the document, wherever it lives.
 *
 * Events, functions **and macros**: a Fetch buried in a macro ships exactly like one on an event,
 * and the reference indexer already learned that omitting macros hides real usage.
 *
 * Exported because the build gate runs this same sweep. Two implementations of "does this project
 * use the network" would be two chances to disagree, and the one that decides whether a build ships
 * is the one that must not be wrong.
 */
export function collectBlueprintNetworkNodes(document: BlueprintDocument | null): BlueprintNetworkNodeSite[] {
    if (!document) {
        return [];
    }
    const sites: BlueprintNetworkNodeSite[] = [];

    // A blueprint reaches the editor through its owner, so a finding without a resolvable ownerKey
    // renders as a row that cannot navigate anywhere (`jumpToSearchTarget` returns false and the
    // report does not check). Blueprints with no owner record are skipped rather than reported
    // un-navigable - they are not reachable in the editor either.
    const ownerKeyByBlueprintId = new Map<string, string>();
    for (const [ownerKey, record] of Object.entries(document.ownerRecords)) {
        for (const blueprintId of [record.activeBlueprintId, ...record.privateBlueprintIds]) {
            if (blueprintId && !ownerKeyByBlueprintId.has(blueprintId)) {
                ownerKeyByBlueprintId.set(blueprintId, ownerKey);
            }
        }
    }

    for (const blueprint of Object.values(document.blueprints)) {
        const ownerKey = ownerKeyByBlueprintId.get(blueprint.id);
        if (!ownerKey || blueprint.program.kind !== "graph") {
            continue;
        }
        const graphs = blueprint.program.graphs;
        const slots = [
            ...Object.entries(graphs.events).map(([graphId, slot]) => ({ focus: "event" as const, graphId, ir: slot.graph })),
            ...Object.entries(graphs.functions).map(([graphId, slot]) => ({ focus: "function" as const, graphId, ir: slot.graph })),
            ...Object.entries(graphs.macros ?? {}).map(([graphId, slot]) => ({ focus: "macro" as const, graphId, ir: slot.graph })),
        ];
        for (const { focus, graphId, ir } of slots) {
            for (const node of Object.values(ir?.nodes ?? {})) {
                if (!NETWORK_NODE_TYPES.has(node.type)) {
                    continue;
                }
                sites.push({
                    blueprintId: blueprint.id,
                    blueprintName: blueprint.name,
                    graphId,
                    nodeId: node.id,
                    nodeType: node.type,
                    target: {
                        kind: "blueprint",
                        blueprintId: blueprint.id,
                        ownerKey,
                        focusNodeId: node.id,
                        ...(focus === "event" ? { focusEventId: graphId } : {}),
                        ...(focus === "function" ? { focusFunctionId: graphId } : {}),
                    },
                });
            }
        }
    }
    return sites;
}

/**
 * A network node in a project whose Allow HTTP setting is off.
 *
 * One finding per node rather than one per project: the author's next action is to open the node
 * and delete it, or to change the setting, and a single project-level finding would name neither.
 */
function runFetchDisallowed(ctx: LintContext): LintFinding[] {
    if (ctx.network.allowHttp) {
        return [];
    }
    return collectBlueprintNetworkNodes(ctx.blueprintDocument).map(site => ({
        ruleId: "network/fetch-disallowed" as const,
        messageKey: "lint.rule.networkFetchDisallowed.message" as const,
        messageParams: { blueprint: site.blueprintName },
        location: {
            kind: "blueprint" as const,
            blueprintId: site.blueprintId,
            blueprintName: site.blueprintName,
            graphId: site.graphId,
            nodeId: site.nodeId,
        },
        target: site.target,
    }));
}

export const NETWORK_LINT_RULES: readonly LintRule[] = [
    {
        id: "network/fetch-disallowed",
        category: "network",
        defaultSeverity: "error",
        slug: "networkFetchDisallowed",
        run: ctx => runFetchDisallowed(ctx),
    },
];
