/**
 * A fingerprint of the story a build ships, taken once when the bundle is assembled.
 *
 * The engine already hashes the story it is running and stamps that into every save, and that hash
 * is unreachable for the thing this one exists for: a title screen listing save slots has no story
 * mounted and no live game to ask. The bundle carries this instead, so "is this save from this
 * story" is answerable before anything has started.
 *
 * Not a security primitive and deliberately not a cryptographic digest. It answers one question -
 * did the shipped story change - for a reader that is on the player's own machine deciding what to
 * offer them. A player who edits a save to claim another hash is giving themselves a load in their
 * own single-player game, the same thing a save editor already does.
 *
 * Comments in English per project convention.
 */

/**
 * Canonical JSON: object keys in sorted order, so two documents that differ only in the order their
 * fields were written hash the same.
 *
 * Without this the hash would answer "did the story change" with "did anything rewrite the file",
 * and a save-and-reopen of an untouched project would invalidate every save a player has. `Map`,
 * `Set` and class instances are not part of a story document; anything not JSON-shaped is written
 * as its `String()` form rather than dropped, so an unexpected value still contributes.
 */
function canonicalize(value: unknown): string {
    if (value === null || value === undefined) {
        return "null";
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(",")}]`;
    }
    switch (typeof value) {
        case "string":
            return JSON.stringify(value);
        case "number":
            return Number.isFinite(value) ? String(value) : "null";
        case "boolean":
            return value ? "true" : "false";
        case "object": {
            const entries = Object.entries(value as Record<string, unknown>)
                .filter(([, item]) => item !== undefined)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
            return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
        }
        default:
            return JSON.stringify(String(value));
    }
}

/**
 * FNV-1a in two independent 32-bit lanes, printed as 16 hex characters.
 *
 * Two lanes rather than one because a 32-bit fingerprint over a whole story collides often enough
 * to matter across a title's lifetime, and a collision here reads as "this save is from this
 * story" when it is not. `Math.imul` keeps each lane in 32-bit integer arithmetic, which is the
 * only way to do this in JavaScript without a BigInt per character.
 */
function fnv1a64(input: string): string {
    let low = 0x811c9dc5;
    let high = 0x01000193;
    for (let index = 0; index < input.length; index++) {
        const code = input.charCodeAt(index);
        low = Math.imul(low ^ code, 0x01000193);
        // A different multiplier per lane, or the two would move in lockstep and carry one lane's
        // worth of information between them.
        high = Math.imul(high ^ (code + index), 0x85ebca6b);
    }
    const hex = (value: number): string => (value >>> 0).toString(16).padStart(8, "0");
    return `${hex(high)}${hex(low)}`;
}

/**
 * The fingerprint of one build's story content.
 *
 * Takes the story documents as this build ships them - after any variant fold and scene drop - so
 * two editions of a title that ship different chapters hash differently, which is what their saves
 * have to reflect. Nothing else in the bundle contributes: an author editing a page, a colour or a
 * translation has not moved anything a save points into, and invalidating saves for that would
 * make the setting useless in practice.
 */
export function computeStoryContentHash(documents: Record<string, unknown> | null | undefined): string {
    if (!documents) {
        return "";
    }
    const ids = Object.keys(documents).sort();
    if (ids.length === 0) {
        return "";
    }
    return fnv1a64(canonicalize(Object.fromEntries(ids.map(id => [id, documents[id]]))));
}
