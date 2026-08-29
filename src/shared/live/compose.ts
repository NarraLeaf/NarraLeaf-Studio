import type { LiveOp } from "./ops";

/**
 * What this window has said and not yet been told about - the layer between a gesture and its
 * answer.
 *
 * **The defect this exists for.** A guest changes nothing on its own initiative: an editing gesture
 * becomes an intent, the intent goes out, and the document does not move until the effect comes
 * back. The owning service therefore reads the record as the gesture would have written it, hands
 * that over, and puts the record back the way it was. So a SECOND gesture inside the same round trip
 * reads a record that has not got the first gesture in it - and states it whole. The host applies
 * both in order and the first one is gone, silently, in the middle of somebody typing.
 *
 * ⚠ **The answer is composition, not optimistic application.** A guest that applied its own
 * operations early would need to take them back when one is refused, and the absence of rollback is
 * what lets this design work without transformation or agreement. So what is held here is what was
 * ASSERTED, and the next gesture is composed against it before it is sent. Nothing on screen moves
 * any earlier than it did.
 *
 * The four verbs it covers are the four that state a whole record (or, for the interface, a whole
 * delta): everything else in the vocabulary names its own change - insert this row, rename this
 * scene - and two of those in flight together do not describe each other.
 */

/**
 * The unit an operation asserts a value for, or null for a verb that asserts none.
 *
 * A string because it is a map key and because it has to distinguish an asset from a translation
 * from a character with the same id - see `LiveClaimKey`, which prefixes for the same reason.
 *
 * The interface has one address for the whole document rather than one per element, and that is
 * not a shortcut: `write-ui` already carries a delta of exactly the records that changed, so two of
 * them compose record by record without anything here having to name one.
 */
export function assertionAddress(op: LiveOp): string | null {
    switch (op.op) {
        case "update-character":
            return `character:${op.characterId}`;
        case "update-asset":
            return `asset:${op.assetType}/${op.assetId}`;
        case "set-translation":
            return `translation:${op.locale}/${op.unitId}`;
        case "write-ui":
            return "ui";
        default:
            return null;
    }
}

/**
 * One record, composed from what this window has already asserted and what this gesture changed.
 *
 * **Three sides, and the base is what makes it sound.** `base` is the record as the document holds
 * it - which is what the gesture was measured against, because the service put it back before this
 * ran. So a field where `next` differs from `base` is a field this gesture touched, and every other
 * field is one it merely restated. Take the touched fields from `next` and everything else from
 * `pending`, and the result is both gestures.
 *
 * Recursive, because these records are nested: a character is a profile and an appearance, and two
 * gestures inside one round trip are usually inside different halves of it. A value that is not an
 * object on all three sides is taken whole - an array is a value here, not a collection, because
 * nothing in it is addressed and a merge of two orderings would be an order neither author chose.
 *
 * ⚠ **Nobody else can be inside this record**, which is why three sides are enough and no fourth
 * ever arrives: all four verbs are claimed, so between the assertion and its answer the only writer
 * is this window. Where a claim was refused there is no assertion to compose against either.
 */
export function composeAssertedRecord<T>(pending: T, base: unknown, next: T): T {
    if (!isRecord(pending) || !isRecord(base) || !isRecord(next)) {
        // Not three records to read field by field. A value stated whole is kept whole: `next`
        // where this gesture changed it, and what was already asserted where it did not.
        return sameJson(base, next) ? pending : next;
    }
    const composed: Record<string, unknown> = { ...pending };
    for (const key of Object.keys(next)) {
        if (sameJson(base[key], next[key])) {
            // Restated, not touched. Whatever was asserted for it stands.
            continue;
        }
        composed[key] = key in pending
            ? composeAssertedRecord(pending[key], base[key], next[key])
            : next[key];
    }
    for (const key of Object.keys(base)) {
        if (!(key in next)) {
            // This gesture took the field away, which is a change like any other.
            delete composed[key];
        }
    }
    return composed as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether two values are the same JSON.
 *
 * `JSON.stringify` rather than a walk: these are small records read off a document that was itself
 * parsed from JSON, key order is stable because both sides come from the same object shape, and the
 * only question asked of it is "did this gesture touch that field".
 */
function sameJson(left: unknown, right: unknown): boolean {
    return left === right || JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
