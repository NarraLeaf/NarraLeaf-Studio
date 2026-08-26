/**
 * The one thing every whole-document digest in a session has to do before it encodes.
 *
 * The canonical encoder rejects an `undefined` property by name, and Studio's services still produce
 * them: a record spread through `{ ...record, ext: undefined }` holds a key whose value is
 * `undefined` where the same record parsed off disk simply has no key. Those two are the same
 * document - `JSON.stringify` writes neither, and that is what is on disk - so hashing them
 * differently would eject a machine from the room over a difference no file can hold.
 *
 * It also keeps a digest from being the one thing in an applier that can throw, which would take the
 * whole session down over a key nobody set.
 *
 * Shared rather than repeated because there are now several documents fingerprinted whole, and a
 * rule that has to hold for all of them cannot be written down once per module.
 */

/**
 * The same value with every `undefined`-valued property dropped, at any depth.
 *
 * A copy rather than an edit: what is passed in is the live document a panel is drawing, and this
 * runs while an effect is being applied.
 */
export function pruneUndefined(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(pruneUndefined);
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (entry !== undefined) {
            out[key] = pruneUndefined(entry);
        }
    }
    return out;
}
