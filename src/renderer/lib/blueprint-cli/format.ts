/**
 * `blueprint format`: lay a `.bp` file's graphs out the way Studio's "Format graph" does.
 *
 * Both run the same function, `layoutBlueprintGraph`, so there is one layout and not two that can
 * drift apart. What differs is where the cards' sizes come from: the canvas measures them, and this
 * works them out from each node's definition (`cardGeometry`). Comment cards carry their size in
 * their params, so a note and a frame are sized here exactly as the canvas sizes them.
 *
 * The file is edited rather than reprinted. Only the `@x,y` at the end of a node's line and a
 * frame's `width` / `height` lines change, so the author's own comments, ordering and spacing in
 * the file survive formatting.
 *
 * Comments in English per project convention.
 */

import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import { readBlueprintCommentSize } from "@shared/blueprint/blueprintCommentGeometry";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes";
import {
    BLUEPRINT_LAYOUT_LOOP_NODE_TYPES,
    layoutBlueprintGraph,
    measureBlueprintLayout,
    type BlueprintLayoutCard,
    type BlueprintLayoutComment,
    type BlueprintLayoutDirection,
    type BlueprintLayoutGraph,
    type BlueprintLayoutMeasure,
} from "@/apps/workspace/modules/blueprint-lite/flow/blueprintAutoLayout";
import type { BpDiagnostic, BpGraphAst, BpNodeAst } from "./dsl/ast";
import { compileBlueprintDocument, type BpCompileOptions } from "./dsl/compile";
import { parseBlueprintText, stripComment } from "./dsl/parse";
import { blueprintFrameContains } from "@/apps/workspace/modules/blueprint-lite/flow/blueprintGroupFrame";
import { BLUEPRINT_CARD_NARROWEST, blueprintCardGeometry } from "./cardGeometry";

export type FormatOptions = {
    direction?: BlueprintLayoutDirection;
    compile?: BpCompileOptions;
};

export type FormattedLayer = {
    blueprint: string;
    layer: string;
    cards: number;
    /** What is left to untangle once formatted, counted on the cards as sized here. */
    after: BlueprintLayoutMeasure;
};

export type FormatResult = {
    text: string;
    layers: FormattedLayer[];
    diagnostics: BpDiagnostic[];
};

export function formatBlueprintSource(source: string, options: FormatOptions = {}): FormatResult {
    const parsed = parseBlueprintText(source);
    const diagnostics = [...parsed.diagnostics];
    if (diagnostics.some(item => item.severity === "error")) {
        return { text: source, layers: [], diagnostics };
    }
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const lines = source.split(/\r?\n/);
    /** Replacement text by line number (1-based). */
    const edits = new Map<number, string>();
    /** Lines to add after a given line number. */
    const additions = new Map<number, string[]>();
    const layers: FormattedLayer[] = [];

    for (const blueprintAst of parsed.document.blueprints) {
        const compiled = compileBlueprintDocument({ blueprints: [blueprintAst] }, options.compile ?? {});
        diagnostics.push(...compiled.diagnostics);
        const blueprint = compiled.blueprints[0];
        if (!blueprint) {
            continue;
        }
        const used = new Set<string>();
        for (const graphAst of blueprintAst.graphs) {
            if (graphAst.kind === "script") {
                continue;
            }
            const ir = findCompiledGraph(blueprint.graphs, graphAst, used);
            if (!ir) {
                continue;
            }
            const graph = layoutGraphOf(ir);
            if (graph.cards.length === 0) {
                continue;
            }
            const result = layoutBlueprintGraph(graph, { direction: options.direction });
            const byId = new Map(graphAst.nodes.map(node => [node.id, node]));
            for (const [id, point] of Object.entries(result.positions)) {
                const node = byId.get(id);
                if (node) {
                    edits.set(node.line, withLayout(edits.get(node.line) ?? lines[node.line - 1]!, point));
                }
            }
            for (const [id, rect] of Object.entries(result.frames)) {
                const node = byId.get(id);
                if (!node) {
                    continue;
                }
                edits.set(node.line, withLayout(edits.get(node.line) ?? lines[node.line - 1]!, rect));
                setParamLine(node, "width", rect.width, lines, edits, additions);
                setParamLine(node, "height", rect.height, lines, edits, additions);
            }
            layers.push({
                blueprint: blueprintAst.name,
                layer: graphAst.name,
                cards: graph.cards.length,
                after: measureBlueprintLayout(graph, result.positions),
            });
        }
    }

    const out: string[] = [];
    lines.forEach((line, index) => {
        const number = index + 1;
        out.push(edits.get(number) ?? line);
        out.push(...(additions.get(number) ?? []));
    });
    return { text: out.join(newline), layers, diagnostics };
}

/** The compiled graph a layer of the file became: by its id when it has one, else by its name. */
function findCompiledGraph(
    graphs: { events?: Record<string, { id: string; name?: string; graph?: BlueprintGraphIr }>; functions?: Record<string, { id: string; name?: string; graph?: BlueprintGraphIr }> },
    ast: BpGraphAst,
    used: Set<string>,
): BlueprintGraphIr | null {
    const pool = Object.values((ast.kind === "function" ? graphs.functions : graphs.events) ?? {});
    const hit = pool.find(item => !used.has(item.id) && (ast.id ? item.id === ast.id : item.name === ast.name));
    if (!hit?.graph) {
        return null;
    }
    used.add(hit.id);
    return hit.graph;
}

/** The graph as the layout reads it, every card sized from its definition. */
export function layoutGraphOf(ir: BlueprintGraphIr): BlueprintLayoutGraph {
    const wired = new Map<string, Set<string>>();
    for (const edge of ir.edges ?? []) {
        const set = wired.get(edge.to.nodeId) ?? new Set<string>();
        set.add(edge.to.port);
        wired.set(edge.to.nodeId, set);
    }
    const cards: BlueprintLayoutCard[] = [];
    const comments: BlueprintLayoutComment[] = [];
    for (const node of Object.values(ir.nodes ?? {})) {
        const params = node.params ?? {};
        const at = (node.meta?.editorLayout as { x?: number; y?: number } | undefined) ?? {};
        const x = typeof at.x === "number" ? at.x : 0;
        const y = typeof at.y === "number" ? at.y : 0;
        const entry = blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, params);
        if (entry.role === "comment") {
            const size = readBlueprintCommentSize(params);
            comments.push({ id: node.id, x, y, width: size.width, height: size.height, frame: params.frame === true });
            continue;
        }
        const geometry = blueprintCardGeometry(entry, params, wired.get(node.id) ?? new Set());
        cards.push({
            id: node.id,
            x,
            y,
            width: geometry.width,
            // The width is an estimate that has to hold in every interface language, so the card is
            // laid out as anything from the narrowest a card is drawn up to that.
            minWidth: BLUEPRINT_CARD_NARROWEST,
            height: geometry.height,
            pins: geometry.pins,
            loop: BLUEPRINT_LAYOUT_LOOP_NODE_TYPES.has(node.type),
        });
    }
    // A frame holds what it fully contains, as on the canvas - but a width here is an estimate
    // rounded up, and a card estimated wider than it is would fall out of the frame the author drew
    // around it. So containment is asked with the narrowest a card can be.
    const probes = cards.map(card => ({
        id: card.id,
        x: card.x,
        y: card.y,
        width: Math.min(card.width, BLUEPRINT_CARD_NARROWEST),
        height: card.height,
    }));
    for (const comment of comments) {
        if (!comment.frame) {
            continue;
        }
        comment.members = [...probes, ...comments.filter(other => other.frame && other.id !== comment.id)]
            .filter(box => blueprintFrameContains(comment, box))
            .map(box => box.id);
    }
    const wires = (ir.edges ?? []).map(edge => ({
        from: edge.from.nodeId,
        fromPin: edge.from.port,
        to: edge.to.nodeId,
        toPin: edge.to.port,
    }));
    return { cards, wires, comments };
}

/** A node's line with its `@x,y` replaced, or added; an end-of-line comment is kept. */
function withLayout(line: string, point: { x: number; y: number }): string {
    const code = stripComment(line);
    const comment = line.slice(code.length);
    const bare = code.replace(/\s+@\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/, "").replace(/\s+$/, "");
    return `${bare} @${Math.round(point.x)},${Math.round(point.y)}${comment ? ` ${comment.trimStart()}` : ""}`;
}

/** Set `key = value` under a node: in place when the file has the line, else right under the node. */
function setParamLine(
    node: BpNodeAst,
    key: string,
    value: number,
    lines: readonly string[],
    edits: Map<number, string>,
    additions: Map<number, string[]>,
): void {
    const param = node.params.find(item => item.key === key);
    if (param) {
        const line = edits.get(param.line) ?? lines[param.line - 1]!;
        const code = stripComment(line);
        const comment = line.slice(code.length);
        const at = code.indexOf("=");
        edits.set(param.line, `${code.slice(0, at + 1)} ${Math.round(value)}${comment ? ` ${comment.trimStart()}` : ""}`);
        return;
    }
    const declaration = lines[node.line - 1]!;
    const indent = /^\s*/.exec(declaration)![0];
    const list = additions.get(node.line) ?? [];
    list.push(`${indent}    ${key} = ${Math.round(value)}`);
    additions.set(node.line, list);
}
