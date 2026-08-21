/**
 * Scalar syntax shared by the parser and the printer.
 *
 * A value is JSON where JSON is unambiguous and a bare word otherwise, because most param values in
 * a real graph are ids (`narraleaf-studio:main-surface`, a uuid, `sound`) and quoting every one of
 * them is noise an author has to get right for nothing. A bare word is always a string; anything
 * that needs to be a number, a boolean or null has to be written as one.
 *
 * Comments in English per project convention.
 */

import type { BpValue } from "./ast";

export class BpValueError extends Error {}

/** Split a line into whitespace-separated tokens, keeping quoted strings and JSON literals whole. */
export function splitTokens(text: string): string[] {
    const out: string[] = [];
    let current = "";
    let quote: string | null = null;
    let depth = 0;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quote) {
            current += ch;
            if (ch === "\\" && i + 1 < text.length) {
                current += text[i + 1];
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
            current += ch;
            continue;
        }
        if (ch === "[" || ch === "{") {
            depth += 1;
            current += ch;
            continue;
        }
        if (ch === "]" || ch === "}") {
            depth -= 1;
            current += ch;
            continue;
        }
        if (depth === 0 && /\s/.test(ch)) {
            if (current.length > 0) {
                out.push(current);
                current = "";
            }
            continue;
        }
        current += ch;
    }
    if (quote) {
        throw new BpValueError(`unterminated ${quote === '"' ? "double" : "single"} quote`);
    }
    if (depth !== 0) {
        throw new BpValueError("unbalanced brackets");
    }
    if (current.length > 0) {
        out.push(current);
    }
    return out;
}

/** Index of the first occurrence of `needle` outside quotes and brackets, or -1. */
export function indexOfTopLevel(text: string, needle: string, from = 0): number {
    let quote: string | null = null;
    let depth = 0;
    for (let i = from; i < text.length; i += 1) {
        const ch = text[i];
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
        if (ch === "[" || ch === "{") {
            depth += 1;
            continue;
        }
        if (ch === "]" || ch === "}") {
            depth -= 1;
            continue;
        }
        if (depth === 0 && text.startsWith(needle, i)) {
            return i;
        }
    }
    return -1;
}

/** Every top-level occurrence of `needle`, used to split `a -> b -> c` chains. */
export function splitTopLevel(text: string, needle: string): string[] {
    const parts: string[] = [];
    let start = 0;
    for (;;) {
        const at = indexOfTopLevel(text, needle, start);
        if (at < 0) {
            parts.push(text.slice(start));
            return parts;
        }
        parts.push(text.slice(start, at));
        start = at + needle.length;
    }
}

export function parseValue(token: string): BpValue {
    const text = token.trim();
    if (text.length === 0) {
        throw new BpValueError("empty value");
    }
    const first = text[0];
    if (first === '"' || first === "'") {
        return { kind: "string", value: parseQuoted(text) };
    }
    if (first === "[" || first === "{") {
        try {
            return { kind: "json", value: JSON.parse(text) };
        } catch (error) {
            throw new BpValueError(`not valid JSON: ${(error as Error).message}`);
        }
    }
    if (text === "true" || text === "false") {
        return { kind: "boolean", value: text === "true" };
    }
    if (text === "null") {
        return { kind: "null" };
    }
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text)) {
        return { kind: "number", value: Number(text) };
    }
    return { kind: "string", value: text };
}

function parseQuoted(text: string): string {
    const quote = text[0];
    if (text.length < 2 || text[text.length - 1] !== quote) {
        throw new BpValueError("unterminated quote");
    }
    const body = text.slice(1, -1);
    let out = "";
    for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (ch !== "\\") {
            out += ch;
            continue;
        }
        const next = body[i + 1];
        i += 1;
        switch (next) {
            case "n":
                out += "\n";
                break;
            case "r":
                out += "\r";
                break;
            case "t":
                out += "\t";
                break;
            case "\\":
                out += "\\";
                break;
            case '"':
                out += '"';
                break;
            case "'":
                out += "'";
                break;
            case undefined:
                throw new BpValueError("trailing backslash");
            default:
                out += next;
        }
    }
    return out;
}

export function valueToJs(value: BpValue): unknown {
    switch (value.kind) {
        case "string":
            return value.value;
        case "number":
            return value.value;
        case "boolean":
            return value.value;
        case "null":
            return null;
        case "json":
            return value.value;
    }
}

/** A bare word survives a parse/print round trip only if it re-reads as the same string. */
export function printValue(value: unknown): string {
    if (value === null) {
        return "null";
    }
    if (typeof value === "boolean" || typeof value === "number") {
        return JSON.stringify(value);
    }
    if (typeof value === "string") {
        return canBeBareWord(value) ? value : JSON.stringify(value);
    }
    return JSON.stringify(value);
}

function canBeBareWord(text: string): boolean {
    if (text.length === 0 || /[\s"'#=<>[\]{},]/.test(text)) {
        return false;
    }
    if (text === "true" || text === "false" || text === "null") {
        return false;
    }
    return !/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text);
}
