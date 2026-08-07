/**
 * What the debugger panel needs to know about the blueprints in the running bundle, as plain
 * functions over the document. No React, no i18n - the panel translates the labels these produce.
 */

import type { Blueprint, BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { isStorySyncValueOwner } from "@shared/types/blueprint/document";
import type { BlueprintBreakpoint } from "@shared/types/blueprint/breakpoints";

export type DebuggableGraphKind = "event" | "function";

export type DebuggableGraph = {
    graphId: string;
    /** Author-given graph name; falls back to the id, which is all that exists for older graphs. */
    name: string;
    kind: DebuggableGraphKind;
    nodeCount: number;
};

export type DebuggableBlueprint = {
    id: string;
    name: string;
    ownerKind: Blueprint["owner"]["kind"];
    /**
     * True for inline value and condition story blueprints. Their graphs run through the
     * synchronous executor, which has no await to suspend on, so breakpoints in them are listed
     * and drawn but can never be hit. Saying so is better than a breakpoint that silently does
     * nothing.
     */
    syncOnly: boolean;
    graphs: DebuggableGraph[];
};

/**
 * Every graph blueprint in the bundle that has something to stop in, sorted for a picker.
 * TypeScript blueprints and script modules are excluded: they are not graphs, so there is no node
 * to put a breakpoint on (their code is debuggable in the window's own DevTools).
 */
export function listDebuggableBlueprints(document: BlueprintDocument | undefined): DebuggableBlueprint[] {
    const out: DebuggableBlueprint[] = [];
    for (const blueprint of Object.values(document?.blueprints ?? {})) {
        if (blueprint.program.kind !== "graph" || blueprint.frontend === "typescript") {
            continue;
        }
        const graphs = listDebuggableGraphs(blueprint);
        if (graphs.length === 0) {
            continue;
        }
        out.push({
            id: blueprint.id,
            name: blueprint.name,
            ownerKind: blueprint.owner.kind,
            syncOnly: isStorySyncValueOwner(blueprint.owner),
            graphs,
        });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function listDebuggableGraphs(blueprint: Blueprint): DebuggableGraph[] {
    if (blueprint.program.kind !== "graph") {
        return [];
    }
    const graphs: DebuggableGraph[] = [];
    const collect = (
        table: Record<string, { id: string; name?: string; graph?: BlueprintGraphIr }> | undefined,
        kind: DebuggableGraphKind,
    ) => {
        for (const entry of Object.values(table ?? {})) {
            const nodeCount = Object.keys(entry.graph?.nodes ?? {}).length;
            if (nodeCount === 0) {
                continue;
            }
            graphs.push({ graphId: entry.id, name: entry.name?.trim() || entry.id, kind, nodeCount });
        }
    };
    collect(blueprint.program.graphs.events, "event");
    collect(blueprint.program.graphs.functions, "function");
    return graphs.sort((a, b) => a.name.localeCompare(b.name));
}

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

const MAX_DEBUG_VALUE_CHARS = 160;

/**
 * One line for a value in the scope view. Whatever the shape, this returns something short: the
 * scope list is scanned, not read, and a 4KB serialized object in a 380px column is noise.
 */
export function formatDebugValue(value: unknown): string {
    if (value === undefined) {
        return "undefined";
    }
    if (value === null) {
        return "null";
    }
    if (typeof value === "string") {
        return truncate(JSON.stringify(value));
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (typeof value === "function") {
        return "ƒ()";
    }
    try {
        return truncate(JSON.stringify(value) ?? String(value));
    } catch {
        return "[unserializable]";
    }
}

function truncate(text: string): string {
    return text.length <= MAX_DEBUG_VALUE_CHARS ? text : `${text.slice(0, MAX_DEBUG_VALUE_CHARS)}…`;
}
