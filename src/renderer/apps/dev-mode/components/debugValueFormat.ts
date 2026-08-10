/**
 * How a value is printed in a debug list, for every panel in the Dev Mode drawer.
 *
 * There were two of these — the runtime panel's (180 chars, strings printed raw) and the debugger's
 * (160 chars, strings quoted, functions as `ƒ()`) — so the same value read differently depending on
 * which panel you happened to have open, which is the one thing a debug readout may not do.
 *
 * The debugger's semantics won. Quoting a string is the only way to see an empty one, a trailing
 * space, or a `"5"` that is text rather than a number, and those are exactly what someone reading a
 * scope list is trying to find out; a raw passthrough hides all three behind something that looks
 * correct.
 */

/**
 * The scope lists are scanned, not read: they sit in a 380px column, so a 4KB serialized object is
 * noise no matter how faithfully it is printed.
 */
export const MAX_DEBUG_VALUE_CHARS = 160;

/** One line for a value in a scope / state list. Whatever the shape, this returns something short. */
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
