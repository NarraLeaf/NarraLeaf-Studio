import { fnv1a64BytesHex } from "@shared/utils/contentHash";

/**
 * The id of the private blueprint that belongs to one owner slot.
 *
 * **Derived from the owner key rather than minted, and the reason is a live session.** The three
 * `ensure*` helpers on `LocalBlueprintService` are called by `UIBlueprintLifecycleCoordinator` after
 * *every* interface mutation, to keep `uigraphs.json` aligned with the Surfaces and widgets in
 * `uidoc.json`. Inside a session that reconciliation is DERIVED work: an interface effect arrives,
 * every machine applies it, and every machine then runs the same reconciliation over the same
 * document. The criterion the whole vocabulary uses is whether everybody can reach the same answer
 * from the same effect - and with a freshly minted uuid they could not, because each machine would
 * invent a different id for the blueprint the effect implies. Two documents that differ, with the
 * digest as the only thing that would ever notice.
 *
 * The alternatives were to make the reconciliation a second operation, or to carry its results on
 * the effect. Both were rejected: a second operation puts one gesture in the room as two messages a
 * press of undo apart, and carrying the results means sending something every receiver could work
 * out for itself - which is exactly what `LiveDerived` exists NOT to be used for.
 *
 * ## Why this is safe outside a session too
 *
 * An owner key contains the uuid of the Surface, element or component it names, so two owner slots
 * can only collide if their ids do. The output is uuid-shaped so that everything downstream that
 * treats a blueprint id as an opaque string goes on doing so, and version 8 - the one the RFC
 * reserves for custom construction - says truthfully that it was not generated at random.
 *
 * Existing projects keep the ids they have: the helpers only mint when the owner slot has no active
 * blueprint, so nothing is rewritten by opening a project built before this.
 */
export function derivedBlueprintId(ownerKey: string): string {
    // Two hashes over two differently prefixed encodings, because one 64-bit hash is sixteen hex
    // characters and a uuid needs thirty-two. The prefixes differ so the two halves cannot come out
    // equal for a key that happens to be a fixed point of neither.
    const high = hash(`nls.blueprint.owner.high:${ownerKey}`);
    const low = hash(`nls.blueprint.owner.low:${ownerKey}`);
    const digits = `${high}${low}`;
    // Version 8 in the version nibble, and the RFC 4122 variant in the variant nibble.
    const versioned = `${digits.slice(0, 12)}8${digits.slice(13, 16)}`;
    const variant = ((parseInt(digits[16], 16) & 0x3) | 0x8).toString(16);
    const tail = `${variant}${digits.slice(17)}`;
    return [
        versioned.slice(0, 8),
        versioned.slice(8, 12),
        versioned.slice(12, 16),
        tail.slice(0, 4),
        tail.slice(4),
    ].join("-");
}

function hash(input: string): string {
    return fnv1a64BytesHex(new TextEncoder().encode(input));
}
