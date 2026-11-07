/**
 * Copying canvas nodes as the blueprint text format.
 *
 * The other half of `graphTextPaste`: the selection is printed as a bare body - node declarations,
 * then `->` edges - which is the shape that paste accepts, `blueprint_apply` takes under a layer
 * header, and an author can hand to a question-answering tool to ask about. It goes through the
 * printer the tools use, so what this writes is what `show` would have written for those nodes.
 *
 * Two things are changed on the way, both for whoever reads the text:
 *
 *  - **Node ids become names.** A node's id is a generated one; the text calls each node after the
 *    last part of its type (`blueprint.log` -> `log`, `log2`), which is what the Skill's examples do.
 *    A paste gives every node a fresh id anyway, so nothing depended on the old ones.
 *  - **Variables are named.** A Get or Set Local carries its variable's id; the text names it, and
 *    a `var` line above the nodes gives its type. A paste resolves the name against the receiving
 *    blueprint, so the same text works in any blueprint that has a variable of that name.
 *
 * Comments in English per project convention.
 */

import type { BlueprintGraphIr, BlueprintGraphNode, BlueprintVariable } from "@shared/types/blueprint/document";
import { printGraphBody } from "@/lib/blueprint-cli/dsl/print";
import { printValue } from "@/lib/blueprint-cli/dsl/values";
import type { BlueprintGraphClipboardPayload } from "./graphClipboard";

/**
 * Words a node line must not start with: the reader takes them as the start of a block, a layer or
 * a member before it looks for the `name:` of a node.
 */
const RESERVED_NODE_NAMES = new Set(["blueprint", "event", "function", "script", "var", "meta", "bindings", "fields", "functions", "graphMeta"]);

/**
 * The text for the nodes a copy holds, or null when it holds none.
 *
 * `variables` are the copying blueprint's own; a variable id they do not name (another blueprint's,
 * written `bp:<id>:<var>`, or one since deleted) is left as it is.
 */
export function printBlueprintGraphText(
    payload: Pick<BlueprintGraphClipboardPayload, "nodeIds" | "nodes" | "edges">,
    variables?: Readonly<Record<string, BlueprintVariable>>,
): string | null {
    const nodeIds = payload.nodeIds.filter(id => payload.nodes[id] != null);
    if (nodeIds.length === 0) {
        return null;
    }

    const names = new Map<string, string>();
    const taken = new Set(RESERVED_NODE_NAMES);
    for (const nodeId of nodeIds) {
        names.set(nodeId, uniqueName(baseName(payload.nodes[nodeId]!.type), taken));
    }

    const used = new Map<string, BlueprintVariable>();
    const nodes: Record<string, BlueprintGraphNode> = {};
    for (const nodeId of nodeIds) {
        const node = payload.nodes[nodeId]!;
        const name = names.get(nodeId)!;
        const variable = typeof node.params?.variableId === "string" ? variables?.[node.params.variableId] : undefined;
        if (variable) {
            used.set(variable.id, variable);
        }
        nodes[name] = {
            ...node,
            id: name,
            ...(variable ? { params: { ...node.params, variableId: variable.name } } : {}),
        };
    }
    const edges: NonNullable<BlueprintGraphIr["edges"]> = payload.edges
        .filter(edge => names.has(edge.from.nodeId) && names.has(edge.to.nodeId))
        .map(edge => ({
            from: { nodeId: names.get(edge.from.nodeId)!, port: edge.from.port },
            to: { nodeId: names.get(edge.to.nodeId)!, port: edge.to.port },
        }));

    const lines: string[] = [];
    for (const variable of used.values()) {
        const parts = ["var", printValue(variable.name)];
        if (variable.valueType) {
            parts.push(`type=${printValue(variable.valueType)}`);
        }
        lines.push(parts.join(" "));
    }
    if (lines.length > 0) {
        lines.push("");
    }
    lines.push(...printGraphBody({ nodes, edges }));
    return `${lines.join("\n")}\n`;
}

/** `blueprint.event.head.appBoot` -> `appBoot`; whatever the type is, an identifier comes out. */
function baseName(type: string): string {
    const last = type.split(".").filter(Boolean).pop() ?? "";
    const cleaned = last.replace(/[^A-Za-z0-9_]/g, "");
    if (cleaned.length === 0) {
        return "node";
    }
    return /^[0-9]/.test(cleaned) ? `n${cleaned}` : cleaned;
}

function uniqueName(base: string, taken: Set<string>): string {
    let name = base;
    for (let suffix = 2; taken.has(name); suffix += 1) {
        name = `${base}${suffix}`;
    }
    taken.add(name);
    return name;
}
