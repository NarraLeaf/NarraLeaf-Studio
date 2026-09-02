/**
 * `BlueprintDocument` -> text format.
 *
 * The inverse of the compiler, and held to it: printing a blueprint and compiling the result has to
 * give the same graph back, ids and canvas positions included. That is what makes the format usable
 * for reading an existing project rather than only for writing new ones - an author can dump what
 * is there, edit two lines, and write it back without the rest of it moving.
 *
 * Comments in English per project convention.
 */

import type {
    Blueprint,
    BlueprintGraphEdge,
    BlueprintGraphIr,
    BlueprintOwnerRef,
} from "@shared/types/blueprint/document";
import type { BpDiagnostic } from "./ast";
import { printValue } from "./values";
import { BLUEPRINT_OWNER_GRAMMAR } from "./ownerGrammar";

export type BpPrintResult = {
    text: string;
    diagnostics: BpDiagnostic[];
};

const INDENT = "    ";
const INLINE_PARAM_BUDGET = 48;

export function printBlueprints(blueprints: readonly Blueprint[]): BpPrintResult {
    const diagnostics: BpDiagnostic[] = [];
    const chunks: string[] = [];
    for (const blueprint of blueprints) {
        chunks.push(printBlueprint(blueprint, diagnostics));
    }
    return { text: chunks.join("\n"), diagnostics };
}

export function printBlueprint(blueprint: Blueprint, diagnostics: BpDiagnostic[] = []): string {
    const lines: string[] = [];
    lines.push(
        [
            "blueprint",
            printValue(blueprint.name),
            ...printOwner(blueprint.owner),
            `id=${blueprint.id}`,
        ].join(" "),
    );

    if (blueprint.frontend !== "visual" || blueprint.programKind !== "graph") {
        diagnostics.push({
            severity: "warning",
            code: "print.not_a_graph",
            message: `"${blueprint.name}" is a ${blueprint.programKind} blueprint; the text format only `
                + "covers visual graphs.",
        });
    }
    if (blueprint.meta && Object.keys(blueprint.meta).length > 0) {
        lines.push(`${INDENT}meta = ${JSON.stringify(blueprint.meta)}`);
    }
    if (blueprint.bindings && Object.keys(blueprint.bindings).length > 0) {
        lines.push(`${INDENT}bindings = ${JSON.stringify(blueprint.bindings)}`);
    }
    const fields = blueprint.members?.fields;
    if (fields && Object.keys(fields).length > 0) {
        lines.push(`${INDENT}fields = ${JSON.stringify(fields)}`);
    }
    const memberFunctions = blueprint.members?.functions;
    if (memberFunctions && Object.keys(memberFunctions).length > 0) {
        lines.push(`${INDENT}functions = ${JSON.stringify(memberFunctions)}`);
    }
    for (const variable of Object.values(blueprint.members?.variables ?? {})) {
        const parts = [`${INDENT}var`, printValue(variable.name)];
        if (variable.valueType) {
            parts.push(`type=${printValue(variable.valueType)}`);
        }
        if (variable.defaultValue !== undefined) {
            parts.push(`default=${printValue(variable.defaultValue)}`);
        }
        parts.push(`id=${variable.id}`);
        lines.push(parts.join(" "));
    }

    if (blueprint.program.kind === "graph") {
        const graphs = blueprint.program.graphs;
        for (const id of orderedIds(graphs.eventIds, graphs.events)) {
            const event = graphs.events?.[id];
            if (event) {
                lines.push("", ...printGraph("event", event.name ?? "Layer 1", id, event.graph));
            }
        }
        for (const id of orderedIds(graphs.functionIds, graphs.functions)) {
            const fn = graphs.functions?.[id];
            if (fn) {
                lines.push("", ...printGraph("function", fn.name ?? "Function", id, fn.graph));
            }
        }
    }

    return `${lines.join("\n")}\n`;
}

function orderedIds(order: string[] | undefined, pool: Record<string, unknown> | undefined): string[] {
    const keys = Object.keys(pool ?? {});
    if (!order || order.length === 0) {
        return keys;
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of order) {
        if (pool?.[id] && !seen.has(id)) {
            seen.add(id);
            out.push(id);
        }
    }
    for (const id of keys) {
        if (!seen.has(id)) {
            out.push(id);
        }
    }
    return out;
}

function printGraph(
    kind: "event" | "function",
    name: string,
    id: string,
    ir: BlueprintGraphIr | undefined,
): string[] {
    const lines = [`${kind} ${printValue(name)} id=${id}`];
    const extraMeta = { ...(ir?.meta ?? {}) } as Record<string, unknown>;
    delete extraMeta.graphKind;
    if (Object.keys(extraMeta).length > 0) {
        lines.push(`${INDENT}graphMeta = ${JSON.stringify(extraMeta)}`);
    }

    const nodes = ir?.nodes ?? {};
    const nodeIds = new Set(Object.keys(nodes));
    for (const [nodeId, node] of Object.entries(nodes)) {
        const params = Object.entries(node.params ?? {});
        const layout = node.meta?.editorLayout as { x?: number; y?: number } | undefined;
        const suffix = layout && typeof layout.x === "number" && typeof layout.y === "number"
            ? ` @${layout.x},${layout.y}`
            : "";
        const inlineable = params.length === 1
            && `${params[0][0]}=${printValue(params[0][1])}`.length <= INLINE_PARAM_BUDGET;
        if (params.length === 0 || inlineable) {
            const inline = inlineable ? ` ${params[0][0]}=${printValue(params[0][1])}` : "";
            lines.push(`${INDENT}${nodeId}: ${node.type}${inline}${suffix}`);
            continue;
        }
        lines.push(`${INDENT}${nodeId}: ${node.type}${suffix}`);
        for (const [key, value] of params) {
            lines.push(`${INDENT}${INDENT}${key} = ${printValue(value)}`);
        }
    }

    const edges = ir?.edges ?? [];
    if (edges.length > 0) {
        lines.push("");
        for (const edge of edges) {
            lines.push(`${INDENT}${printEndpoint(edge, "from", nodeIds)} -> ${printEndpoint(edge, "to", nodeIds)}`);
        }
    }
    return lines;
}

/**
 * `node.port`, unless that string is itself the id of another node in this graph - node ids may
 * contain dots, and the reader resolves the whole string as an id before it tries splitting one off.
 */
function printEndpoint(edge: BlueprintGraphEdge, side: "from" | "to", nodeIds: ReadonlySet<string>): string {
    const { nodeId, port } = edge[side];
    return nodeIds.has(`${nodeId}.${port}`) ? `${nodeId}:${port}` : `${nodeId}.${port}`;
}

/**
 * The `owner=` line, read straight off the grammar the reader is built from.
 *
 * Written as a walk rather than one arm per kind because the two have to agree exactly - a file this
 * prints is a file `apply` reads back - and the arms did not: the old fallback labelled an owner it
 * did not recognise `owner=globalMain`, so `show` on a kind added later would have quietly rewritten
 * it as a project-wide blueprint instead of failing.
 */
function printOwner(owner: BlueprintOwnerRef): string[] {
    const parts = [`owner=${owner.kind}`];
    const carried = owner as unknown as Record<string, unknown>;
    for (const field of BLUEPRINT_OWNER_GRAMMAR[owner.kind]) {
        const value = carried[field.prop];
        // An optional field the owner does not carry is simply not written; a required one that is
        // missing is a broken owner, and saying so is `check`'s job, not the printer's.
        if (value === undefined || value === null || value === "") {
            continue;
        }
        parts.push(`${field.text}=${printValue(value)}`);
    }
    return parts;
}
