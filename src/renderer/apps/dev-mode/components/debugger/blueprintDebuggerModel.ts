/**
 * What the debugger panel needs to know about the blueprints in the running bundle, as plain
 * functions over the document. No React, no i18n - the panel translates the labels these produce.
 *
 * Which blueprints the picker lists is NOT here: that question is asked by two panels with two
 * different answers, and both are settled in `../blueprintDebugPanelModel`.
 */

import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { BlueprintBreakpoint } from "@shared/types/blueprint/breakpoints";

export function resolveBlueprintGraphIr(
    document: BlueprintDocument | undefined,
    blueprintId: string | undefined,
    graphId: string | undefined,
): BlueprintGraphIr | undefined {
    if (!blueprintId || !graphId) {
        return undefined;
    }
    const blueprint = document?.blueprints[blueprintId];
    if (!blueprint || blueprint.program.kind !== "graph") {
        return undefined;
    }
    return (
        blueprint.program.graphs.events?.[graphId]?.graph ??
        blueprint.program.graphs.functions?.[graphId]?.graph
    );
}

/** The graph's authored name, for a call-stack row or a breakpoint list entry. */
export function resolveBlueprintGraphName(
    document: BlueprintDocument | undefined,
    blueprintId: string | undefined,
    graphId: string | undefined,
): string | undefined {
    if (!blueprintId || !graphId) {
        return undefined;
    }
    const blueprint = document?.blueprints[blueprintId];
    if (!blueprint || blueprint.program.kind !== "graph") {
        return undefined;
    }
    const entry = blueprint.program.graphs.events?.[graphId] ?? blueprint.program.graphs.functions?.[graphId];
    return entry?.name?.trim() || undefined;
}

/** Author-facing node label for a breakpoint row: the node's type is all the IR carries by itself. */
export function resolveBlueprintNodeType(
    document: BlueprintDocument | undefined,
    breakpoint: BlueprintBreakpoint,
): string | undefined {
    return resolveBlueprintGraphIr(document, breakpoint.blueprintId, breakpoint.graphId)?.nodes?.[breakpoint.nodeId]
        ?.type;
}

/** Breakpoints grouped by the blueprint they sit in, both sides sorted for a stable list. */
export function groupBreakpointsByBlueprint(
    breakpoints: readonly BlueprintBreakpoint[],
    document: BlueprintDocument | undefined,
): { blueprintId: string; blueprintName: string; breakpoints: BlueprintBreakpoint[] }[] {
    const groups = new Map<string, BlueprintBreakpoint[]>();
    for (const breakpoint of breakpoints) {
        const list = groups.get(breakpoint.blueprintId);
        if (list) {
            list.push(breakpoint);
        } else {
            groups.set(breakpoint.blueprintId, [breakpoint]);
        }
    }
    return [...groups.entries()]
        .map(([blueprintId, entries]) => ({
            blueprintId,
            blueprintName: document?.blueprints[blueprintId]?.name ?? blueprintId,
            breakpoints: entries.sort((a, b) =>
                a.graphId === b.graphId ? a.nodeId.localeCompare(b.nodeId) : a.graphId.localeCompare(b.graphId),
            ),
        }))
        .sort((a, b) => a.blueprintName.localeCompare(b.blueprintName));
}
