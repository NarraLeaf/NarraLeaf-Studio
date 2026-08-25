import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import type { CharacterGroup, StoredCharacter } from "@shared/types/character/model";
import { fnv1a64BytesHex } from "@shared/utils/contentHash";

/**
 * The cast as a live session reads it, and the fingerprints of the two units its operations address.
 *
 * The digests are the same instrument as `sceneDigest` and serve the same purpose - **disagreement,
 * not change detection**. Every machine in a session applies the same operations in the same order
 * and should therefore hold the same cast; one that computes a different digest is wrong, or the host
 * is, and neither can tell which. That is the most expensive way this design can fail, so a guest
 * that disagrees leaves the session and says so.
 *
 * Both are built on the canonical encoder for the reason the scene digest is: two copies of one
 * record may have been assembled by different code paths - one parsed off disk, one adopted from a
 * message - and `JSON.stringify` would call them different over key order alone, which is a
 * disagreement nobody can act on. Sixty-four bits, again for the reason the hashing module gives:
 * this guards a decision.
 *
 * **Two units rather than one, and the split is what keeps both cheap.** A record digest covers one
 * character's content and where it sits; a cast digest covers the shape of the cast and nothing
 * inside any member. Between them every operation fingerprints what it changed, and neither ever
 * encodes the whole store - which is what a per-document digest would do on every keystroke that
 * reaches the panel.
 */

/** What a session needs to be able to read about the cast, however the reader stores it. */
export type LiveCastView = {
    /** Records by id. */
    characters: Readonly<Record<string, StoredCharacter>>;
    /** The order the panel shows them in, by id. */
    order: readonly string[];
    /** Groups by id. */
    groups: Readonly<Record<string, CharacterGroup>>;
};

/** One character's record and where it sits, or the fact that there is no such record. */
export type LiveCharacterAt = {
    record: StoredCharacter | null;
    /** Its index in the cast's order, or null when it is not in the cast. */
    at: number | null;
};

/**
 * One character's content **and its position**, or the fact that there is no such record.
 *
 * **A missing record has a digest of its own rather than no digest**, and that is the difference
 * between this and the scene digest, where an unreadable scene produces null. Deleting a character is
 * an operation like any other, and the machine that failed to apply it has to be caught: with null
 * the guard would rule `unproven` on exactly the effect that proves the two copies parted company. So
 * absence is a value here, and a machine that still holds the record hashes something else.
 *
 * The position is in because creating a character changes two things - the record exists, and it sits
 * somewhere - and a digest over the record alone would let a machine that appended where everybody
 * else inserted pass unnoticed until the next rearrangement. It costs one number.
 *
 * Nothing is stripped on the way in. A record carries no per-machine bookkeeping - unlike a scene,
 * whose `meta.updatedAt` is stamped from whichever clock applied the edit - so there is no field here
 * that two machines could legitimately disagree about.
 */
export function characterRecordDigest(input: LiveCharacterAt): string {
    return hash(input.record === null ? { absent: true } : { record: input.record, at: input.at });
}

/**
 * The shape of the cast: who is in it, in what order, what groups exist, and who is in which.
 *
 * Where `reorder-cast`, `set-character-group` and `delete-character-group` land, because all three
 * change the shape rather than the content of a member. Keeping them in one scope means a group
 * deletion - which also moves its members out - is fingerprinted by the same value a rearrangement
 * is, and a machine that applied either of them differently is caught either way.
 *
 * Membership is here even though a character's `groupId` lives on its record, and that is deliberate:
 * moving members out of a deleted group is the half of that operation a record digest would not see,
 * because no `update-character` was sent for any of them. It costs one small map.
 *
 * ⚠ **A group's `createdAt` and `updatedAt` are hashed, and that is a decision rather than an
 * oversight.** They are minted by whichever machine created the group and travel inside the
 * operation, so every machine writes the same numbers - unlike a scene's `updatedAt`, which each
 * machine stamps for itself. The day a group's timestamp is ever set locally, it has to come out of
 * this hash, or every group edit will eject the room.
 */
export function castDigest(cast: LiveCastView): string {
    const membership: Record<string, string | null> = {};
    for (const id of cast.order) {
        membership[id] = cast.characters[id]?.profile.groupId ?? null;
    }
    return hash({ order: [...cast.order], groups: cast.groups, membership });
}

/** Where a character sits in the cast, and what it holds. The input both digests are read through. */
export function characterAt(cast: LiveCastView, characterId: string): LiveCharacterAt {
    const record = cast.characters[characterId] ?? null;
    if (!record) {
        return { record: null, at: null };
    }
    const index = cast.order.indexOf(characterId);
    return { record, at: index < 0 ? null : index };
}

function hash(content: unknown): string {
    return fnv1a64BytesHex(new TextEncoder().encode(encodeCanonicalJson(content)));
}
