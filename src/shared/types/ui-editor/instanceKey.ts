/**
 * How the keys of nested drawings are put together.
 *
 * An instance key says which drawing of a template something belongs to, and drawings nest: a list
 * row can hold a component placement, a component definition can hold a list, a row can hold a
 * list of its own. The key of an inner drawing is therefore the key of the drawing it sits in with
 * one more segment on the end, outermost first. That is what lets anything holding a key answer
 * "which rows and which placements am I inside", and what keeps two outer rows' copies of the same
 * inner row apart - a key made of the innermost segment alone names the same drawing in every one
 * of them.
 *
 * Each kind of drawing owns its segment's spelling (`componentInstanceKey.ts`, `list.ts`); this file
 * owns only the joint between segments, so there is one separator for all of them.
 *
 * Comments in English per project convention.
 */

const SEPARATOR = "\0";

/** The key of a drawing made inside the drawing `outer` names, or at the top level when there is none. */
export function appendUIInstanceKeySegment(outer: string | undefined | null, segment: string): string {
    return outer ? `${outer}${SEPARATOR}${segment}` : segment;
}

/** The segments of a key, outermost first. An empty or missing key has none. */
export function splitUIInstanceKey(instanceKey: string | undefined | null): string[] {
    return instanceKey ? instanceKey.split(SEPARATOR) : [];
}

/** The key those segments spell, or undefined for none - which is how "no drawing" is written everywhere. */
export function joinUIInstanceKeySegments(segments: readonly string[]): string | undefined {
    return segments.length > 0 ? segments.join(SEPARATOR) : undefined;
}
