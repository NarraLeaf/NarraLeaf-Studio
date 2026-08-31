/**
 * `.ui` text into an AST.
 *
 * The format is line-oriented and **indentation is the tree**: an interface document is a tree of
 * elements, so nesting says what contains what and there is nothing else for it to say. That is the
 * one deliberate difference from `.bp`, where indentation is cosmetic because a graph's shape lives
 * in its edges.
 *
 * A body line is an assignment when its second token is `=`, a directive when its first token is one
 * of the few keywords the enclosing block declares, and an element header otherwise. The `=` test
 * comes first, so a widget that one day has a prop called `component` is still writable.
 *
 * Comments in English per project convention.
 */

import { BpValueError, indexOfTopLevel, parseValue, splitTokens, valueToJs } from "../../blueprint-cli/dsl/values";
import type {
    UiAssignTarget,
    UiAssignment,
    UiBindingLine,
    UiComponentStatement,
    UiElementNode,
    UiFile,
    UiStatement,
    UiStructStatement,
    UiSurfaceStatement,
} from "./ast";

export class UiParseError extends Error {
    public constructor(
        message: string,
        public readonly line: number,
    ) {
        super(`line ${line}: ${message}`);
    }
}

type SourceLine = {
    number: number;
    indent: number;
    text: string;
};

/** Assignment prefixes that reach past `props`, which is where an unprefixed key goes. */
const ASSIGN_TARGETS: Record<string, UiAssignTarget> = {
    layout: "layout",
    style: "style",
    extra: "extra",
};

/** Keys of the element record itself, written without a prefix because they are not props. */
const ELEMENT_KEYS = new Set(["animation", "assetVariants"]);

export function parseUiFile(source: string): UiFile {
    const lines = readLines(source);
    const statements: UiStatement[] = [];
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (line.indent !== 0) {
            throw new UiParseError("unexpected indentation at the top level.", line.number);
        }
        const [statement, next] = parseStatement(lines, index);
        statements.push(statement);
        index = next;
    }
    return { statements };
}

/** Strips comments and blank lines, and measures indentation with a tab worth four columns. */
function readLines(source: string): SourceLine[] {
    const out: SourceLine[] = [];
    const raw = source.split(/\r?\n/);
    for (let i = 0; i < raw.length; i += 1) {
        const text = raw[i];
        let cut: number;
        try {
            cut = indexOfTopLevel(text, "#");
        } catch {
            // An unbalanced line is reported where it is used, with a better message than "#".
            cut = -1;
        }
        const body = cut >= 0 ? text.slice(0, cut) : text;
        if (body.trim().length === 0) {
            continue;
        }
        let indent = 0;
        for (const ch of body) {
            if (ch === " ") {
                indent += 1;
            } else if (ch === "\t") {
                indent += 4;
            } else {
                break;
            }
        }
        out.push({ number: i + 1, indent, text: body.trim() });
    }
    return out;
}

/** The lines strictly more indented than `lines[start]`, which form its body. */
function bodyOf(lines: SourceLine[], start: number): { body: SourceLine[]; next: number } {
    const outer = lines[start].indent;
    let end = start + 1;
    while (end < lines.length && lines[end].indent > outer) {
        end += 1;
    }
    return { body: lines.slice(start + 1, end), next: end };
}

function parseStatement(lines: SourceLine[], index: number): [UiStatement, number] {
    const line = lines[index];
    const tokens = tokensOf(line);
    const head = tokens[0];
    const { body, next } = bodyOf(lines, index);
    switch (head) {
        case "document":
            return [parseDocument(line, tokens), next];
        case "surface":
            return [parseSurface(line, tokens, body), next];
        case "component":
            return [parseComponent(line, tokens, body), next];
        case "struct":
            return [parseStruct(line, tokens, body), next];
        case "action":
            return [parseAction(line, tokens, body), next];
        default:
            throw new UiParseError(
                `"${head}" starts nothing. A file holds document / surface / component / struct / action blocks.`,
                line.number,
            );
    }
}

function tokensOf(line: SourceLine): string[] {
    try {
        return splitTokens(line.text);
    } catch (error) {
        throw new UiParseError((error as Error).message, line.number);
    }
}

// ---------------------------------------------------------------------------
// Top-level blocks
// ---------------------------------------------------------------------------

function parseDocument(line: SourceLine, tokens: string[]): UiStatement {
    const rest = tokens.slice(1);
    const name = rest.length > 0 && !rest[0].includes("=") ? readString(rest.shift() as string, line) : "";
    const flags = readFlags(rest, line);
    return { kind: "document", line: line.number, name, id: flags.id };
}

function parseSurface(line: SourceLine, tokens: string[], body: SourceLine[]): UiSurfaceStatement {
    const rest = tokens.slice(1);
    if (rest.length === 0) {
        throw new UiParseError('a surface needs a name: `surface "Title"`.', line.number);
    }
    const name = readString(rest.shift() as string, line);
    const flags = readFlags(rest, line);
    const slotId = flags.slot;
    const surfaceKind = (flags.kind ?? (slotId ? "stageSurface" : "appSurface")) as "appSurface" | "stageSurface";
    if (surfaceKind !== "appSurface" && surfaceKind !== "stageSurface") {
        throw new UiParseError(`kind must be appSurface or stageSurface, got "${flags.kind}".`, line.number);
    }
    const statement: UiSurfaceStatement = {
        kind: "surface",
        line: line.number,
        name,
        id: flags.id,
        surfaceKind,
        slotId,
        designSize: flags.size ? readSize(flags.size, line) : undefined,
        settings: [],
        answers: [],
        slots: [],
        root: null,
    };
    for (const item of blockItems(body)) {
        const itemTokens = tokensOf(item.line);
        if (itemTokens[0] === "setting" && itemTokens[2] === "=") {
            statement.settings.push(readAssignment(item.line, itemTokens.slice(1)));
            continue;
        }
        if (itemTokens[0] === "answers") {
            const answerFlags = readFlags(itemTokens.slice(2), item.line);
            statement.answers.push({
                line: item.line.number,
                actionId: readString(itemTokens[1] ?? "", item.line),
                consume: answerFlags.consume === undefined ? undefined : answerFlags.consume === "true",
            });
            continue;
        }
        if (itemTokens[0] === "slot") {
            const slotFlags = readFlags(itemTokens.slice(3), item.line);
            statement.slots.push({
                line: item.line.number,
                id: readString(itemTokens[1] ?? "", item.line),
                name: readString(itemTokens[2] ?? itemTokens[1] ?? "", item.line),
                rootElementId: slotFlags.root,
            });
            continue;
        }
        if (statement.root) {
            throw new UiParseError("a surface holds one root element; move this under it.", item.line.number);
        }
        statement.root = parseElement(item.line, itemTokens, item.body);
    }
    return statement;
}

function parseComponent(line: SourceLine, tokens: string[], body: SourceLine[]): UiComponentStatement {
    const rest = tokens.slice(1);
    if (rest.length === 0) {
        throw new UiParseError('a component needs a name: `component "Save slot"`.', line.number);
    }
    const name = readString(rest.shift() as string, line);
    const flags = readFlags(rest, line);
    const statement: UiComponentStatement = {
        kind: "component",
        line: line.number,
        name,
        id: flags.id,
        params: [],
        previewMeta: flags.size ? readSize(flags.size, line) : undefined,
        root: null,
    };
    for (const item of blockItems(body)) {
        const itemTokens = tokensOf(item.line);
        if (itemTokens[0] === "param") {
            // `param slot "Slot" = "1"` - id, author-facing name, default value.
            const id = readString(itemTokens[1] ?? "", item.line);
            const eq = itemTokens.indexOf("=");
            const nameToken = itemTokens[2] && itemTokens[2] !== "=" ? itemTokens[2] : id;
            const defaultValue = eq >= 0 ? String(readJs(itemTokens[eq + 1] ?? '""', item.line) ?? "") : "";
            statement.params.push({
                line: item.line.number,
                id,
                name: readString(nameToken, item.line),
                defaultValue,
            });
            continue;
        }
        if (statement.root) {
            throw new UiParseError("a component holds one root element; move this under it.", item.line.number);
        }
        statement.root = parseElement(item.line, itemTokens, item.body);
    }
    return statement;
}

function parseStruct(line: SourceLine, tokens: string[], body: SourceLine[]): UiStructStatement {
    const id = readString(tokens[1] ?? "", line);
    if (!id) {
        throw new UiParseError("a struct needs an id: `struct nl.saveEntry`.", line.number);
    }
    const statement: UiStructStatement = { kind: "struct", line: line.number, id, fields: [] };
    for (const item of blockItems(body)) {
        const itemTokens = tokensOf(item.line);
        if (itemTokens[0] !== "field") {
            throw new UiParseError("a struct holds `field <key>: <type>` lines.", item.line.number);
        }
        // `field slot: string label="Slot" id=slot`
        const head = itemTokens[1] ?? "";
        const key = readString(head.endsWith(":") ? head.slice(0, -1) : head, item.line);
        const type = readString(itemTokens[2] ?? "string", item.line);
        const flags = readFlags(itemTokens.slice(3), item.line);
        statement.fields.push({
            line: item.line.number,
            id: flags.id ?? key,
            key,
            label: flags.label,
            type,
        });
    }
    return statement;
}

function parseAction(line: SourceLine, tokens: string[], body: SourceLine[]): UiStatement {
    const id = readString(tokens[1] ?? "", line);
    if (!id) {
        throw new UiParseError('an action needs an id: `action advance "Advance"`.', line.number);
    }
    const name = tokens[2] ? readString(tokens[2], line) : id;
    const bindings: ({ kind: "pointer"; gesture: string } | { kind: "key"; key: string })[] = [];
    for (const item of blockItems(body)) {
        const itemTokens = tokensOf(item.line);
        if (itemTokens[0] === "pointer") {
            bindings.push({ kind: "pointer", gesture: readString(itemTokens[1] ?? "", item.line) });
            continue;
        }
        if (itemTokens[0] === "key") {
            bindings.push({ kind: "key", key: readString(itemTokens[1] ?? "", item.line) });
            continue;
        }
        throw new UiParseError("an action holds `pointer <gesture>` and `key <Key>` lines.", item.line.number);
    }
    return { kind: "action", line: line.number, id, name, bindings };
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

function parseElement(line: SourceLine, tokens: string[], body: SourceLine[]): UiElementNode {
    const rest = [...tokens];
    let name: string | undefined;
    if (rest.length >= 2 && rest[1] === ":") {
        name = readString(rest.shift() as string, line);
        rest.shift();
    } else if (rest[0] && rest[0].endsWith(":") && rest[0].length > 1) {
        name = readString((rest.shift() as string).slice(0, -1), line);
    }
    const type = rest.shift();
    if (!type) {
        throw new UiParseError("an element line needs a widget type.", line.number);
    }
    const node: UiElementNode = {
        line: line.number,
        name,
        type: readString(type, line),
        assignments: [],
        bindings: [],
        children: [],
    };
    for (const token of rest) {
        const position = /^@(-?[\d.]+),(-?[\d.]+)$/.exec(token);
        if (position) {
            node.assignments.push(assign(line, "layout", ["x"], Number(position[1])));
            node.assignments.push(assign(line, "layout", ["y"], Number(position[2])));
            continue;
        }
        const size = /^(-?[\d.]+)x(-?[\d.]+)$/.exec(token);
        if (size) {
            node.assignments.push(assign(line, "layout", ["width"], Number(size[1])));
            node.assignments.push(assign(line, "layout", ["height"], Number(size[2])));
            continue;
        }
        const eq = token.indexOf("=");
        if (eq > 0) {
            const key = token.slice(0, eq);
            if (key === "id") {
                node.id = readString(token.slice(eq + 1), line);
                continue;
            }
            throw new UiParseError(`"${key}=" is not a header flag; write it on its own line.`, line.number);
        }
        throw new UiParseError(`did not understand "${token}" on an element line.`, line.number);
    }
    for (const item of blockItems(body)) {
        const itemTokens = tokensOf(item.line);
        if (itemTokens[1] === "=") {
            node.assignments.push(readAssignment(item.line, itemTokens));
            continue;
        }
        if (itemTokens[0] === "bind") {
            node.bindings.push(readBinding(item.line, itemTokens));
            continue;
        }
        if (itemTokens[0] === "component") {
            const params: Record<string, string> = {};
            for (const token of itemTokens.slice(2)) {
                const eq = token.indexOf("=");
                if (eq <= 0) {
                    throw new UiParseError(`component params are written key=value, got "${token}".`, item.line.number);
                }
                params[token.slice(0, eq)] = String(readJs(token.slice(eq + 1), item.line) ?? "");
            }
            node.componentLink = {
                line: item.line.number,
                componentId: readString(itemTokens[1] ?? "", item.line),
                params,
            };
            continue;
        }
        node.children.push(parseElement(item.line, itemTokens, item.body));
    }
    return node;
}

function readAssignment(line: SourceLine, tokens: string[]): UiAssignment {
    const key = readString(tokens[0], line);
    const valueToken = tokens.slice(2).join(" ");
    if (valueToken.length === 0) {
        throw new UiParseError(`"${key} =" has no value.`, line.number);
    }
    const value = readJs(valueToken, line);
    const parts = key.split(".");
    const prefix = ASSIGN_TARGETS[parts[0]];
    if (prefix && parts.length > 1) {
        return assign(line, prefix, parts.slice(1), value);
    }
    if (ELEMENT_KEYS.has(parts[0]) && parts.length === 1) {
        return assign(line, "element", parts, value);
    }
    return assign(line, "props", parts, value);
}

function readBinding(line: SourceLine, tokens: string[]): UiBindingLine {
    // `bind text = blueprint <id> [valueType=string]` or `bind text = field <fieldId>`
    const propPath = readString(tokens[1] ?? "", line);
    if (tokens[2] !== "=") {
        throw new UiParseError("a bind line reads `bind <prop> = blueprint <id>` or `= field <id>`.", line.number);
    }
    const source = tokens[3];
    if (source === "blueprint") {
        const flags = readFlags(tokens.slice(5), line);
        return {
            line: line.number,
            propPath,
            source: {
                kind: "blueprintValue",
                blueprintId: readString(tokens[4] ?? "", line),
                valueType: flags.valueType,
            },
        };
    }
    if (source === "field") {
        return {
            line: line.number,
            propPath,
            source: { kind: "listItemField", fieldId: readString(tokens[4] ?? "", line) },
        };
    }
    throw new UiParseError(`a binding source is "blueprint" or "field", got "${source ?? ""}".`, line.number);
}

function assign(line: SourceLine, target: UiAssignTarget, path: string[], value: unknown): UiAssignment {
    return { line: line.number, target, path, value };
}

// ---------------------------------------------------------------------------
// Shared readers
// ---------------------------------------------------------------------------

/** One nested block: its own line plus the lines under it. */
function blockItems(body: SourceLine[]): { line: SourceLine; body: SourceLine[] }[] {
    const out: { line: SourceLine; body: SourceLine[] }[] = [];
    let index = 0;
    while (index < body.length) {
        const { body: inner, next } = bodyOf(body, index);
        out.push({ line: body[index], body: inner });
        index = next;
    }
    return out;
}

function readString(token: string, line: SourceLine): string {
    const value = readJs(token, line);
    return typeof value === "string" ? value : String(value);
}

function readJs(token: string, line: SourceLine): unknown {
    try {
        return valueToJs(parseValue(token));
    } catch (error) {
        const message = error instanceof BpValueError ? error.message : (error as Error).message;
        throw new UiParseError(message, line.number);
    }
}

/** `key=value` tokens on a header line, read as strings. */
function readFlags(tokens: string[], line: SourceLine): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const token of tokens) {
        const eq = token.indexOf("=");
        if (eq <= 0) {
            throw new UiParseError(`expected key=value, got "${token}".`, line.number);
        }
        out[token.slice(0, eq)] = String(readJs(token.slice(eq + 1), line) ?? "");
    }
    return out;
}

function readSize(text: string, line: SourceLine): { width: number; height: number } {
    const match = /^(-?[\d.]+)x(-?[\d.]+)$/.exec(text);
    if (!match) {
        throw new UiParseError(`a size is written WxH, got "${text}".`, line.number);
    }
    return { width: Number(match[1]), height: Number(match[2]) };
}
