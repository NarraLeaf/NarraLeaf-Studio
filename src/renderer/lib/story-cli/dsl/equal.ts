/**
 * When two rows say the same thing.
 *
 * Asked in two places for two reasons, and it has to be the same answer in both: the printer asks it
 * to decide whether a line it wrote reads back as the row it came from, and the compiler asks it to
 * decide whether a line it read is the row that was already there. A single implementation is what
 * makes those two agree - a printer stricter than the compiler would refuse rows it could spell, and
 * a compiler stricter than the printer would rewrite rows nobody edited.
 *
 * Comments in English per project convention.
 */

import type { StoryBlock } from "@shared/types/story";

/**
 * Whether two rows say the same thing.
 *
 * Identity and placement are excluded, because a line carries neither: a row's id comes from its
 * anchor and its place in the tree from its indentation, so a rebuild differing in either says
 * nothing about whether the SPELLING was faithful. Everything else - kind, payload, disabled - has
 * to match exactly.
 */
export function sameRowContent(left: StoryBlock, right: StoryBlock): boolean {
    if (left.kind !== right.kind || (left.disabled === true) !== (right.disabled === true)) {
        return false;
    }
    return canonical(normalise(left.payload)) === canonical(normalise(right.payload));
}

/**
 * JSON with sorted keys and absent values dropped.
 *
 * Both halves are load-bearing: a payload is built by spreading objects, so key order carries no
 * meaning and comparing raw `JSON.stringify` would report every rebuilt row as different; and a
 * `build` really does write `undefined` onto a field it is not setting, which is the same state as
 * not writing it at all.
 */
export function canonical(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value ?? null);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

/**
 * The one field whose stated value and whose absence are the same value.
 *
 * `StoryTransformRef.mode` documents itself as "absent means props", so a stored `mode: "props"` and
 * a rebuilt ref without one are the same ref - and comparing them raw would report every transform
 * written before a Story Motion existed as unspellable.
 *
 * Deliberately the only entry. Every other near-miss found while measuring this was a real
 * difference wearing a plausible face: an absent through-colour compiles to `#000` while a stored one
 * says `#000000`, which is the same colour and not the same payload, and normalising it would make
 * this a matter of opinion rather than of equality. Those rows stay opaque, which loses nothing - the
 * row is preserved exactly - where a wrong normalisation would rewrite them.
 */
function normalise(payload: unknown): unknown {
    if (payload === null || typeof payload !== "object") {
        return payload;
    }
    if (Array.isArray(payload)) {
        return payload.map(normalise);
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
        if (key === "mode" && value === "props") {
            continue;
        }
        out[key] = normalise(value);
    }
    return out;
}
