/**
 * Text format -> AST.
 *
 * Line-oriented and indentation-insensitive on purpose. What a line means is decided by what it
 * contains (`->` is an edge, `<-` wires an input, `:` before `=` declares a node) and by which
 * block is open, never by how far it is indented - an agent writing one of these files gets the
 * indentation wrong long before it gets the arrows wrong, and a format that punishes the first
 * failure teaches nothing about the second.
 *
 * Comments in English per project convention.
 */

import type {
    BpBlueprintAst,
    BpDiagnostic,
    BpDocumentAst,
    BpEdgeAst,
    BpEndpointAst,
    BpGraphAst,
    BpNodeAst,
    BpValue,
    BpVariableAst,
} from "./ast";
import { indexOfTopLevel, parseValue, splitTokens, splitTopLevel } from "./values";

export type BpParseResult = {
    document: BpDocumentAst;
    diagnostics: BpDiagnostic[];
};

const OWNER_FIELD_ALIASES: Record<string, string> = {
    surface: "surfaceId",
    surfaceid: "surfaceId",
    element: "elementId",
    elementid: "elementId",
    prop: "propPath",
    proppath: "propPath",
    component: "componentId",
    componentid: "componentId",
    asset: "assetId",
    assetid: "assetId",
    blueprint: "blueprintId",
    blueprintid: "blueprintId",
    mode: "mode",
};

type FailFn = (line: number, code: string, message: string, hint?: string) => void;

export function parseBlueprintText(source: string): BpParseResult {
    const diagnostics: BpDiagnostic[] = [];
    const blueprints: BpBlueprintAst[] = [];
    let blueprint: BpBlueprintAst | null = null;
    let graph: BpGraphAst | null = null;
    let node: BpNodeAst | null = null;

    const fail: FailFn = (line, code, message, hint) => {
        diagnostics.push({ severity: "error", code, message, line, hint });
    };

    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const lineNumber = index + 1;
        const text = stripComment(lines[index]).trim();
        if (text.length === 0) {
            continue;
        }

        const keyword = blockKeyword(text);
        if (keyword === "blueprint") {
            const parsed = parseBlueprintHeader(text, lineNumber, fail);
            if (!parsed) {
                continue;
            }
            blueprint = parsed;
            blueprints.push(parsed);
            graph = null;
            node = null;
            continue;
        }
        if (keyword === "event" || keyword === "function") {
            if (!blueprint) {
                fail(lineNumber, "dsl.orphan_graph", `"${keyword}" before any "blueprint" line.`);
                continue;
            }
            const parsed = parseGraphHeader(keyword, text, lineNumber, fail);
            if (!parsed) {
                continue;
            }
            graph = parsed;
            blueprint.graphs.push(parsed);
            node = null;
            continue;
        }
        if (keyword === "var") {
            if (!blueprint) {
                fail(lineNumber, "dsl.orphan_var", '"var" before any "blueprint" line.');
                continue;
            }
            parseVariable(text, lineNumber, blueprint, fail);
            continue;
        }

        if (indexOfTopLevel(text, "->") >= 0) {
            if (!graph) {
                fail(lineNumber, "dsl.orphan_edge", 'Edge outside any "event" or "function" block.');
                continue;
            }
            node = null;
            pushChainEdges(text, lineNumber, graph, fail);
            continue;
        }

        const feed = indexOfTopLevel(text, "<-");
        if (feed >= 0) {
            if (!node) {
                fail(
                    lineNumber,
                    "dsl.orphan_input",
                    "A `pin <- source` line must follow the node declaration it belongs to.",
                );
                continue;
            }
            const pin = text.slice(0, feed).trim();
            const from = text.slice(feed + 2).trim();
            if (pin.length === 0 || from.length === 0) {
                fail(lineNumber, "dsl.syntax", "Expected `<pin> <- <node>.<port>`.");
                continue;
            }
            node.inputs.push({ pin, source: makeEndpoint(from, lineNumber), line: lineNumber });
            continue;
        }

        const colon = indexOfTopLevel(text, ":");
        const equals = indexOfTopLevel(text, "=");
        if (colon >= 0 && (equals < 0 || colon < equals)) {
            if (!graph) {
                fail(
                    lineNumber,
                    "dsl.orphan_node",
                    'Node declared outside any "event" or "function" block.',
                );
                continue;
            }
            const parsed = parseNodeDecl(text, colon, lineNumber, fail);
            if (!parsed) {
                continue;
            }
            node = parsed;
            graph.nodes.push(parsed);
            continue;
        }
        if (equals >= 0) {
            const key = text.slice(0, equals).trim();
            const rest = text.slice(equals + 1).trim();
            if (key.length === 0) {
                fail(lineNumber, "dsl.syntax", "Expected `<key> = <value>`.");
                continue;
            }
            let value: BpValue;
            try {
                value = parseValue(rest);
            } catch (error) {
                fail(lineNumber, "dsl.bad_value", `${key}: ${(error as Error).message}`);
                continue;
            }
            if (node) {
                node.params.push({ key, value, line: lineNumber });
            } else if (graph) {
                applyGraphKey(graph, key, value, lineNumber, fail);
            } else if (blueprint) {
                applyBlueprintKey(blueprint, key, value, lineNumber, fail);
            } else {
                fail(lineNumber, "dsl.orphan_param", `"${key}" before any "blueprint" line.`);
            }
            continue;
        }

        fail(
            lineNumber,
            "dsl.syntax",
            "Cannot read this line.",
            "Expected one of: `blueprint ...`, `event ...`, `<id>: <nodeType>`, `<key> = <value>`, "
                + "`<pin> <- <node>.<port>`, `<node> -> <node>`.",
        );
    }

    return { document: { blueprints }, diagnostics };
}

/**
 * The block keyword a line opens, if any.
 *
 * `event` opens an event layer, but `event = saves:refresh` sets a node param that happens to be
 * called `event` - and one of those is in the shipped skeleton. What separates them is the `=`, so
 * a keyword only counts when what follows it is not an assignment.
 */
function blockKeyword(text: string): string {
    const match = /^(blueprint|event|function|var)(\s+|$)/.exec(text);
    if (!match) {
        return "";
    }
    const rest = text.slice(match[0].length).trimStart();
    return rest.startsWith("=") || rest.startsWith(":") ? "" : match[1];
}

/** Cut a trailing `#` comment, leaving `#` characters that sit inside a quoted string alone. */
function stripComment(line: string): string {
    let quote: string | null = null;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote) {
            if (ch === "\\") {
                i += 1;
                continue;
            }
            if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === "#") {
            return line.slice(0, i);
        }
    }
    return line;
}

function readString(token: string): string {
    try {
        const parsed = parseValue(token);
        return parsed.kind === "string" ? parsed.value : token;
    } catch {
        return token;
    }
}

function parseBlueprintHeader(text: string, line: number, fail: FailFn): BpBlueprintAst | null {
    let tokens: string[];
    try {
        tokens = splitTokens(text);
    } catch (error) {
        fail(line, "dsl.syntax", (error as Error).message);
        return null;
    }
    tokens.shift();
    if (tokens.length === 0) {
        fail(line, "dsl.blueprint_name", "Expected `blueprint <name> owner=<kind> ...`.");
        return null;
    }
    const blueprint: BpBlueprintAst = {
        name: readString(tokens.shift() as string),
        ownerKind: "",
        ownerFields: {},
        variables: [],
        graphs: [],
        line,
    };
    for (const token of tokens) {
        const at = indexOfTopLevel(token, "=");
        if (at < 0) {
            fail(line, "dsl.syntax", `Expected \`key=value\`, got "${token}".`);
            continue;
        }
        const key = token.slice(0, at).trim();
        const value = readString(token.slice(at + 1).trim());
        if (key === "owner") {
            blueprint.ownerKind = value;
            continue;
        }
        if (key === "id") {
            blueprint.id = value;
            continue;
        }
        const mapped = OWNER_FIELD_ALIASES[key.toLowerCase()];
        if (!mapped) {
            fail(
                line,
                "dsl.unknown_owner_field",
                `Unknown blueprint field "${key}".`,
                "Known fields: owner, id, surface, element, prop, component, asset, blueprint, mode.",
            );
            continue;
        }
        blueprint.ownerFields[mapped] = value;
    }
    if (!blueprint.ownerKind) {
        fail(
            line,
            "dsl.missing_owner",
            "Blueprint has no `owner=`.",
            "One of: globalMain, surfaceMain, widgetMain, widgetValue, componentWidgetMain, "
                + "sharedAsset, storyAction.",
        );
    }
    return blueprint;
}

function parseGraphHeader(
    keyword: "event" | "function",
    text: string,
    line: number,
    fail: FailFn,
): BpGraphAst | null {
    let tokens: string[];
    try {
        tokens = splitTokens(text);
    } catch (error) {
        fail(line, "dsl.syntax", (error as Error).message);
        return null;
    }
    tokens.shift();
    let name = keyword === "event" ? "Layer 1" : "Function";
    if (tokens.length > 0 && indexOfTopLevel(tokens[0], "=") < 0) {
        name = readString(tokens.shift() as string);
    }
    const graph: BpGraphAst = { kind: keyword, name, nodes: [], edges: [], line };
    for (const token of tokens) {
        const at = indexOfTopLevel(token, "=");
        if (at < 0) {
            fail(line, "dsl.syntax", `Expected \`key=value\`, got "${token}".`);
            continue;
        }
        const key = token.slice(0, at).trim();
        if (key !== "id") {
            fail(
                line,
                "dsl.unknown_graph_field",
                `Unknown ${keyword} field "${key}".`,
                'Only "id" is accepted here.',
            );
            continue;
        }
        graph.id = readString(token.slice(at + 1).trim());
    }
    return graph;
}

function parseVariable(text: string, line: number, blueprint: BpBlueprintAst, fail: FailFn): void {
    let tokens: string[];
    try {
        tokens = splitTokens(text);
    } catch (error) {
        fail(line, "dsl.syntax", (error as Error).message);
        return;
    }
    tokens.shift();
    if (tokens.length === 0) {
        fail(line, "dsl.syntax", "Expected `var <name> [type=<valueType>] [default=<value>] [id=<id>]`.");
        return;
    }
    const variable: BpVariableAst = { name: readString(tokens.shift() as string), line };
    for (const token of tokens) {
        const at = indexOfTopLevel(token, "=");
        if (at < 0) {
            fail(line, "dsl.syntax", `Expected \`key=value\`, got "${token}".`);
            continue;
        }
        const key = token.slice(0, at).trim();
        const raw = token.slice(at + 1).trim();
        if (key === "type") {
            variable.valueType = readString(raw);
        } else if (key === "id") {
            variable.id = readString(raw);
        } else if (key === "default") {
            try {
                variable.defaultValue = parseValue(raw);
            } catch (error) {
                fail(line, "dsl.bad_value", `default: ${(error as Error).message}`);
            }
        } else {
            fail(line, "dsl.unknown_var_field", `Unknown var field "${key}".`, "Known: type, default, id.");
        }
    }
    blueprint.variables.push(variable);
}

function parseNodeDecl(text: string, colon: number, line: number, fail: FailFn): BpNodeAst | null {
    const id = text.slice(0, colon).trim();
    let rest = text.slice(colon + 1).trim();
    if (id.length === 0) {
        fail(line, "dsl.syntax", "Node declaration has no id.");
        return null;
    }
    let layout: { x: number; y: number } | undefined;
    const layoutMatch = /\s@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(` ${rest}`);
    if (layoutMatch) {
        layout = { x: Number(layoutMatch[1]), y: Number(layoutMatch[2]) };
        rest = ` ${rest}`.slice(0, layoutMatch.index).trim();
    }
    let tokens: string[];
    try {
        tokens = splitTokens(rest);
    } catch (error) {
        fail(line, "dsl.syntax", (error as Error).message);
        return null;
    }
    if (tokens.length === 0) {
        fail(line, "dsl.missing_node_type", `Node "${id}" has no node type.`, "Write `<id>: <nodeType>`.");
        return null;
    }
    const node: BpNodeAst = { id, type: tokens[0], params: [], inputs: [], layout, line };
    for (const token of tokens.slice(1)) {
        const at = indexOfTopLevel(token, "=");
        if (at < 0) {
            fail(line, "dsl.syntax", `Expected \`key=value\` after the node type, got "${token}".`);
            continue;
        }
        const key = token.slice(0, at).trim();
        try {
            node.params.push({ key, value: parseValue(token.slice(at + 1).trim()), line });
        } catch (error) {
            fail(line, "dsl.bad_value", `${key}: ${(error as Error).message}`);
        }
    }
    return node;
}

function pushChainEdges(text: string, line: number, graph: BpGraphAst, fail: FailFn): void {
    const parts = splitTopLevel(text, "->").map(part => part.trim());
    if (parts.some(part => part.length === 0)) {
        fail(line, "dsl.syntax", "Edge has an empty endpoint.", "Write `<node>.<port> -> <node>.<port>`.");
        return;
    }
    for (let i = 0; i + 1 < parts.length; i += 1) {
        const edge: BpEdgeAst = {
            from: makeEndpoint(parts[i], line),
            to: makeEndpoint(parts[i + 1], line),
            line,
        };
        graph.edges.push(edge);
    }
}

/** Endpoints are resolved against the graph's declared node ids; see `resolveEndpoint`. */
function makeEndpoint(raw: string, line: number): BpEndpointAst {
    return { raw, line };
}

function applyGraphKey(graph: BpGraphAst, key: string, value: BpValue, line: number, fail: FailFn): void {
    if (key === "graphMeta") {
        graph.meta = value.kind === "json" ? value.value : undefined;
        return;
    }
    if (key === "id") {
        graph.id = value.kind === "string" ? value.value : undefined;
        return;
    }
    fail(
        line,
        "dsl.unknown_graph_field",
        `"${key}" is not a graph field.`,
        "A `key = value` line here belongs to the graph; node params must follow a node declaration.",
    );
}

function applyBlueprintKey(
    blueprint: BpBlueprintAst,
    key: string,
    value: BpValue,
    line: number,
    fail: FailFn,
): void {
    const raw = value.kind === "json" ? value.value : value.kind === "string" ? value.value : undefined;
    switch (key) {
        case "meta":
            blueprint.meta = raw;
            return;
        case "bindings":
            blueprint.bindings = raw;
            return;
        case "fields":
            blueprint.fields = raw;
            return;
        case "functions":
            blueprint.functions = raw;
            return;
        case "id":
            blueprint.id = typeof raw === "string" ? raw : undefined;
            return;
        default:
            fail(
                line,
                "dsl.unknown_blueprint_field",
                `"${key}" is not a blueprint field.`,
                "Known: id, meta, bindings, fields, functions. Node params must follow a node declaration.",
            );
    }
}
