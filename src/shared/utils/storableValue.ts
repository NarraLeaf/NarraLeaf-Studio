/**
 * Reading one value out of a save's `store` without going through the engine.
 *
 * The engine wraps every stored value before it writes it: `{type, data}`, plus the positions
 * inside `data` that held a `Date` or an `undefined`, because JSON has neither. `Namespace.get`
 * hands back the unwrapped value, so nothing that reads a *running* game ever meets this shape -
 * only something reading a serialized one does.
 *
 * Which is a thing exactly one caller does: the `Return to where it stopped` policy carries a
 * save's saved-scope values into a story it is starting again, and by then the save is a document
 * rather than a game. There is no published API that revives one (`Namespace` exposes `set`/`get`
 * and nothing that takes wrapped data), so this reads it against the shape the engine's own
 * typings document as part of the on-disk save format.
 *
 * ⚠ It is therefore a second reader of a format somebody else owns. Two things would make it
 * silently wrong: the engine adding another out-of-band annotation beside `dates`/`undefineds`,
 * or changing what `type` means. Both would show up as a value that carries across as JSON-ish
 * instead of as itself - which is precisely how the bug this was written for behaved, so the test
 * beside it asserts on values that are not JSON-representable rather than on plain booleans.
 *
 * Comments in English per project convention.
 */

/** One position inside a stored value: the property keys walked from its root. */
type StorablePath = (string | number)[];

type WrappedStorableData = {
    type?: string;
    data?: unknown;
    /** Positions in `data` that held a `Date`, stored as an ISO 8601 string. */
    dates?: StorablePath[];
    /** Positions in `data` that held `undefined`, stored as `null`. */
    undefineds?: StorablePath[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/** Whether a value carries the wrapper at all. A raw value is passed through untouched. */
function isWrapped(value: unknown): value is WrappedStorableData {
    return isRecord(value) && !Array.isArray(value) && "type" in value && "data" in value;
}

/**
 * Apply one annotated position, returning the (possibly new) root.
 *
 * Walks by plain property access, which is what the engine's own `StorablePath` documents: an
 * array index and an object key are read the same way. A path that no longer resolves is skipped
 * rather than created - the annotation describes `data`, so one that misses means the two
 * disagree, and inventing the missing branch would be inventing a value.
 */
function applyAtPath(root: unknown, path: StorablePath, value: unknown): unknown {
    if (path.length === 0) {
        return value;
    }
    let cursor: unknown = root;
    for (let index = 0; index < path.length - 1; index++) {
        if (!isRecord(cursor)) {
            return root;
        }
        cursor = (cursor as Record<string | number, unknown>)[path[index]];
    }
    if (isRecord(cursor)) {
        (cursor as Record<string | number, unknown>)[path[path.length - 1]] = value;
    }
    return root;
}

function readAtPath(root: unknown, path: StorablePath): unknown {
    let cursor: unknown = root;
    for (const step of path) {
        if (!isRecord(cursor)) {
            return undefined;
        }
        cursor = (cursor as Record<string | number, unknown>)[step];
    }
    return cursor;
}

/**
 * The live value a wrapped one stands for.
 *
 * `data` is mutated in place and returned: it comes from a freshly parsed save record that nothing
 * else holds, and copying a whole playthrough's worth of values to avoid touching it would cost
 * more than it protects.
 */
export function readWrappedStorableValue(wrapped: unknown): unknown {
    if (!isWrapped(wrapped)) {
        return wrapped;
    }
    let value = wrapped.data;
    // A value that is itself a Date. Handled by `type` as well as by an empty `dates` path,
    // because the engine is free to record it either way and both mean the same thing.
    if (wrapped.type === "date" && typeof value === "string") {
        return new Date(value);
    }
    for (const path of wrapped.dates ?? []) {
        if (!Array.isArray(path)) {
            continue;
        }
        const iso = readAtPath(value, path);
        value = applyAtPath(value, path, typeof iso === "string" ? new Date(iso) : iso);
    }
    for (const path of wrapped.undefineds ?? []) {
        if (Array.isArray(path)) {
            value = applyAtPath(value, path, undefined);
        }
    }
    return value;
}

/** Every value in one serialized namespace, unwrapped, keyed as the namespace keys them. */
export function readWrappedStorableNamespace(namespace: unknown): Record<string, unknown> {
    if (!isRecord(namespace) || Array.isArray(namespace)) {
        return {};
    }
    const out: Record<string, unknown> = {};
    for (const [key, wrapped] of Object.entries(namespace)) {
        out[key] = readWrappedStorableValue(wrapped);
    }
    return out;
}
