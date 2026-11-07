/**
 * Pasting the blueprint text format onto the canvas.
 *
 * The text is the one `blueprint_apply` and `project/app/blueprint.js` read, so a layer an author got
 * from a question-answering tool, or copied out of the Skill, becomes nodes without a round trip
 * through a file. Three shapes are accepted, because that is how the format turns up in an answer:
 *
 *  - a whole file: a `blueprint` header and one layer;
 *  - one layer: an `event` or `function` header and its body;
 *  - a bare body: node declarations, `pin <- source` lines and `->` edges.
 *
 * The missing headers are supplied, the real owner and the receiving graph's kind are put in place
 * of whatever was written, and the result goes through the same parser and compiler as the tools -
 * so every message about an unknown node type, a missing pin or a node this owner does not offer is
 * the compiler's own, on the author's own line number. A paste that the compiler refuses changes
 * nothing.
 *
 * What comes out is a clipboard payload, so the paste itself is the ordinary one: fresh node ids,
 * the usual offset, one undo step.
 *
 * Comments in English per project convention.
 */

import type { Blueprint, BlueprintGraphIr, BlueprintOwnerRef, BlueprintVariable } from "@shared/types/blueprint/document";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import type { BpDiagnostic, BpDocumentAst, BpGraphAst } from "@/lib/blueprint-cli/dsl/ast";
import { compileBlueprintDocument } from "@/lib/blueprint-cli/dsl/compile";
import { blueprintOwnerFieldsOf } from "@/lib/blueprint-cli/dsl/ownerGrammar";
import { parseBlueprintText } from "@/lib/blueprint-cli/dsl/parse";
import {
    BLUEPRINT_GRAPH_CLIPBOARD_KIND,
    BLUEPRINT_GRAPH_CLIPBOARD_VERSION,
    type BlueprintGraphClipboardPayload,
} from "./graphClipboard";

/** The graph a text paste lands in, and what the compiler needs to know about where that is. */
export type BlueprintTextPasteTarget = {
    owner: BlueprintOwnerRef;
    /** The kind of the graph open on the canvas; the text's own layer keyword is not consulted. */
    graphKind: "event" | "function";
    /** The receiving blueprint's variables, so a Get or Set Local can name one. */
    variables?: Readonly<Record<string, BlueprintVariable>>;
    /** The widget's type, for a widget's own blueprint: which event heads it may carry depends on it. */
    widgetElementType?: string;
    uiElements?: Readonly<Record<string, UIElement>>;
    uiStructs?: Readonly<Record<string, UIStructDef>>;
};

export type BlueprintTextPasteOutcome =
    /** The text is not the blueprint format at all; the paste carries on as if there were no text. */
    | { kind: "none" }
    /** The text is the format, and it cannot go here. Errors first, each on the author's line. */
    | { kind: "refused"; diagnostics: BpDiagnostic[] }
    /** Ready to paste. `warnings` are what the compiler noted and let through. */
    | { kind: "ready"; payload: BlueprintGraphClipboardPayload; warnings: BpDiagnostic[] };

const SYNTHETIC_BLUEPRINT_HEADER = `blueprint "paste" owner=globalMain`;
const SYNTHETIC_LAYER_HEADER = `event "paste"`;

/**
 * What a text paste would put on the canvas, or why it cannot.
 *
 * `none` is kept for text that has no block header and declares no node with a dotted type - a
 * sentence, a URL, a word copied from a field - so pasting one leaves the canvas as it was, exactly
 * as before text was read. Anything else is taken as an attempt at the format, and a mistake in it
 * is reported rather than ignored.
 */
export function readBlueprintTextPaste(text: string, target: BlueprintTextPasteTarget): BlueprintTextPasteOutcome {
    const source = withoutCodeFences(text);
    if (source.trim().length === 0) {
        return { kind: "none" };
    }

    const probe = parseBlueprintText(source);
    const prefix: string[] = probe.document.blueprints.length > 0
        ? []
        : probe.diagnostics.some(diagnostic => diagnostic.code === "dsl.orphan_graph")
            ? [SYNTHETIC_BLUEPRINT_HEADER]
            : [SYNTHETIC_BLUEPRINT_HEADER, SYNTHETIC_LAYER_HEADER];
    const offset = prefix.length;
    const parsed = parseBlueprintText([...prefix, source].join("\n"));
    const document = parsed.document;

    // Without a header of its own, the text has to declare a node whose type reads like one - every
    // node type is a dotted name (`blueprint.log`, `nl.setImageAsset`). That is what keeps a URL
    // (`https: //...`) or a note (`Note: ...`) from being read as a misspelt node.
    if (offset === 2 && !declaresDottedNodeType(document)) {
        return { kind: "none" };
    }

    const parseErrors = parsed.diagnostics.filter(diagnostic => diagnostic.severity === "error");
    if (parseErrors.length > 0) {
        return { kind: "refused", diagnostics: shiftLines(parseErrors, offset) };
    }

    const layer = pickSingleLayer(document, offset);
    if ("refused" in layer) {
        return { kind: "refused", diagnostics: layer.refused };
    }
    const blueprintAst = document.blueprints[0]!;

    // Where the nodes are going, not where the text says. The owner decides which nodes the palette
    // offers and which heads a widget has, and the receiving graph's kind decides what a layer may hold.
    blueprintAst.ownerKind = target.owner.kind;
    blueprintAst.ownerFields = blueprintOwnerFieldsOf(target.owner);
    delete blueprintAst.id;
    layer.graph.kind = target.graphKind;
    delete layer.graph.id;

    const variableErrors = adoptReceivingVariables(blueprintAst, target.variables);
    if (variableErrors.length > 0) {
        return { kind: "refused", diagnostics: shiftLines(variableErrors, offset) };
    }
    blueprintAst.graphs = [layer.graph];

    let counter = 0;
    const compiled = compileBlueprintDocument(document, {
        newId: () => `paste-${(counter += 1)}`,
        resolveWidgetElementType: () => target.widgetElementType,
        resolveElementType: elementId => target.uiElements?.[elementId]?.type,
        uiElements: target.uiElements,
        uiStructs: target.uiStructs,
    });
    const diagnostics = shiftLines(compiled.diagnostics, offset);
    // A node the palette would not offer on this owner is a warning to the tools, which must be able to
    // write back whatever a project already holds. A paste is a new drawing, and the canvas would not
    // have let anyone draw it - the same line the layer templates hold.
    const refusals = diagnostics.filter(
        diagnostic => diagnostic.severity === "error" || diagnostic.code === "compile.out_of_scope",
    );
    if (refusals.length > 0) {
        return { kind: "refused", diagnostics: refusals };
    }

    const graph = compiledGraph(compiled.blueprints[0]?.graphs, target.graphKind);
    const nodeIds = Object.keys(graph?.nodes ?? {});
    if (!graph || nodeIds.length === 0) {
        return {
            kind: "refused",
            diagnostics: [{
                severity: "error",
                code: "paste.no_nodes",
                message: "The text declares no node.",
                line: layer.graph.line - offset > 0 ? layer.graph.line - offset : undefined,
            }],
        };
    }
    return {
        kind: "ready",
        payload: {
            v: BLUEPRINT_GRAPH_CLIPBOARD_VERSION,
            kind: BLUEPRINT_GRAPH_CLIPBOARD_KIND,
            nodeIds,
            nodes: graph.nodes ?? {},
            edges: graph.edges ?? [],
        },
        warnings: diagnostics.filter(diagnostic => diagnostic.severity === "warning"),
    };
}

const DOTTED_NODE_TYPE = /^[A-Za-z_][\w-]*(\.[\w-]+)+$/;

function declaresDottedNodeType(document: BpDocumentAst): boolean {
    return document.blueprints.some(blueprint =>
        blueprint.graphs.some(graph => graph.nodes.some(node => DOTTED_NODE_TYPE.test(node.type))));
}

/**
 * The text with Markdown fence lines blanked.
 *
 * An answer from a chat tool arrives inside ```` ``` ```` fences more often than not, and a fence is
 * not part of the format. The line is emptied rather than removed so every line number still matches
 * the text the author copied.
 */
function withoutCodeFences(text: string): string {
    return text
        .split(/\r?\n/)
        .map(line => (/^\s*(```|~~~)/.test(line) ? "" : line))
        .join("\n");
}

/** One canvas holds one graph, so the text may carry one blueprint with one graph layer in it. */
function pickSingleLayer(
    document: BpDocumentAst,
    offset: number,
): { graph: BpGraphAst } | { refused: BpDiagnostic[] } {
    const line = (value: number) => (value - offset > 0 ? value - offset : undefined);
    if (document.blueprints.length > 1) {
        return {
            refused: [{
                severity: "error",
                code: "paste.many_blueprints",
                message: `The text holds ${document.blueprints.length} blueprints; paste one layer at a time.`,
                line: line(document.blueprints[1]!.line),
            }],
        };
    }
    const graphs = document.blueprints[0]?.graphs ?? [];
    const script = graphs.find(graph => graph.kind === "script");
    if (script) {
        return {
            refused: [{
                severity: "error",
                code: "paste.script_layer",
                message: "A script layer names a file and has no nodes to paste.",
                line: line(script.line),
            }],
        };
    }
    if (graphs.length !== 1) {
        return {
            refused: [{
                severity: "error",
                code: "paste.many_layers",
                message: graphs.length === 0
                    ? "The text has no event or function layer."
                    : `The text holds ${graphs.length} layers; paste one layer at a time.`,
                line: graphs[1] ? line(graphs[1].line) : undefined,
            }],
        };
    }
    return { graph: graphs[0]! };
}

/**
 * Put the receiving blueprint's variables in place of the ones the text declares.
 *
 * A paste adds nodes, never members, so a Get or Set Local in the text must name a variable the
 * blueprint already has - by id or by name, which the compiler resolves from this list. A `var` line
 * naming one that exists is accepted as the author restating it; one naming a variable this blueprint
 * does not have is refused, because the node would point at nothing.
 */
function adoptReceivingVariables(
    blueprintAst: BpDocumentAst["blueprints"][number],
    variables: Readonly<Record<string, BlueprintVariable>> | undefined,
): BpDiagnostic[] {
    const existing = Object.values(variables ?? {});
    const names = new Set(existing.map(variable => variable.name));
    const ids = new Set(existing.map(variable => variable.id));
    const errors: BpDiagnostic[] = blueprintAst.variables
        .filter(variable => !names.has(variable.name) && !(variable.id && ids.has(variable.id)))
        .map(variable => ({
            severity: "error",
            code: "paste.unknown_variable",
            message: `This blueprint has no variable "${variable.name}".`,
            line: variable.line,
            hint: "Add the variable to the blueprint first, then paste again.",
        }));
    blueprintAst.variables = existing.map(variable => ({
        name: variable.name,
        id: variable.id,
        ...(variable.valueType ? { valueType: variable.valueType } : {}),
        line: 0,
    }));
    return errors;
}

function compiledGraph(graphs: Blueprint["graphs"] | undefined, kind: "event" | "function"): BlueprintGraphIr | undefined {
    if (!graphs) {
        return undefined;
    }
    return kind === "event"
        ? Object.values(graphs.events)[0]?.graph
        : Object.values(graphs.functions)[0]?.graph;
}

/** Diagnostics in the author's line numbers, with the supplied header lines taken off. */
function shiftLines(diagnostics: readonly BpDiagnostic[], offset: number): BpDiagnostic[] {
    if (offset === 0) {
        return [...diagnostics];
    }
    return diagnostics.map(diagnostic => {
        if (diagnostic.line === undefined) {
            return diagnostic;
        }
        const line = diagnostic.line - offset;
        const { line: _line, ...rest } = diagnostic;
        return line > 0 ? { ...rest, line } : rest;
    });
}
