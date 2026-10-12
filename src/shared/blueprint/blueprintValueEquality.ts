/**
 * What "equal" means for two blueprint values: they hold the same content.
 *
 * Equal and Not Equal, Array Contains, Index Of, Unique, Find and Filter by key, and the build's
 * folding of a variant comparison all answer with this one rule, so a value an array node finds in a
 * list is a value Equal calls the same. Numbers compare by value (an integer 1 and a float 1 are the
 * same number) and text exactly; a list compares item by item, and an object field by field
 * whatever order its fields were written in. Values the editor hands out as records - an element, an
 * image, a colour, a point, a save slot - are compared by what they record, so two reads of one
 * element are equal; each read builds a new record, and comparing those by identity made an
 * element unequal even to itself. Nothing converts between kinds: the number 1 and the text "1" are different values. A missing
 * value - an input left unconnected - is Null, as Is Null already reads it, and so is a number that
 * is not finite.
 */

/** Nesting deeper than this is compared by identity: a guard against a value that contains itself. */
const MAX_DEPTH = 64;

export function blueprintValuesEqual(a: unknown, b: unknown): boolean {
    return sameContent(a, b, 0);
}

function sameContent(a: unknown, b: unknown, depth: number): boolean {
    const left = normalizeScalar(a);
    const right = normalizeScalar(b);
    if (left === right) {
        return true;
    }
    if (
        depth >= MAX_DEPTH ||
        left === null ||
        right === null ||
        typeof left !== "object" ||
        typeof right !== "object"
    ) {
        return false;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        return (
            Array.isArray(left) &&
            Array.isArray(right) &&
            left.length === right.length &&
            left.every((item, index) => sameContent(item, right[index], depth + 1))
        );
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    if (leftKeys.length !== Object.keys(rightRecord).length) {
        return false;
    }
    return leftKeys.every(
        key => Object.prototype.hasOwnProperty.call(rightRecord, key) && sameContent(leftRecord[key], rightRecord[key], depth + 1),
    );
}

function normalizeScalar(value: unknown): unknown {
    if (value === undefined) {
        return null;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
        return null;
    }
    if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
        return String(value);
    }
    return value;
}
