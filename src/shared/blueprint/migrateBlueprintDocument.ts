/**
 * BlueprintDocument disk migration (shared between Workspace UIGraphService and main-process Dev Mode reads).
 *
 * ## Every conversion here is gated on a version
 *
 * This used to open v2 through v9 and, on every read including a current one, run four param-level
 * rewrites that were never gated on a version: declarations becoming fields, persistent variables
 * leaving the document, `speed` becoming `cps`, `soundChannel` becoming an audio track. Each existed
 * for graphs written by a build of a product that has never shipped, and the last document that
 * could carry any of those shapes was written at v8 or earlier - except the sound one, whose window
 * at v10 was four days wide in July and left nothing behind on any project this repository has.
 *
 * So the floor is {@link BLUEPRINT_DOCUMENT_MIN_SUPPORTED_VERSION}, and what is left above it is a
 * stamp plus two passes that each name the version they belong to: the owner-key escaping at v11 and
 * the shared-asset removal at v12. v9 needs no conversion at all to become v10: v10 only added
 * `eventIds` / `functionIds`, the arrays that carry the graph-slot order key order used to imply, and
 * `reconcileOrder` already reads a document with no arrays by falling back to key order - which for a
 * v9 document IS the authored order.
 *
 * A document below the floor is refused by name rather than half-read.
 */
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { captureBlueprintDocumentEventOrder, captureBlueprintDocumentFunctionOrder } from "./blueprintEventOrder";
import { decodeLegacyBlueprintOwnerKey, encodeBlueprintOwnerKey } from "./ownerKey";

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The oldest document version this build can read.
 *
 * v9 rather than v10 because v9 is the last version whose difference from the current one is
 * carried by data the reader can still recover on its own - the graph-slot order, which the order
 * capture below takes off the raw object before anything rebuilds it. v8 and below differ by shapes
 * that need a converter, and those converters are gone.
 */
export const BLUEPRINT_DOCUMENT_MIN_SUPPORTED_VERSION = 9;

/** Brings a v9 document to the current version. Idempotent for one already there. */
export function migrateBlueprintDocumentToLatest(raw: unknown): BlueprintDocument {
    if (!isRecord(raw)) {
        throw new Error("BlueprintDocument: expected object");
    }
    // v10 (H2a). Before anything else, because a later pass rebuilds objects (`{...doc, blueprints}`,
    // `{...graphs, events, functions}`) and the graph-slot order exists only as the key order of
    // `events` / `functions` until these two lines have run. Nothing downstream can recover it once
    // a rebuild has reinserted the keys, and the result would look like a perfectly valid order
    // rather than like data loss.
    captureBlueprintDocumentEventOrder(raw);
    captureBlueprintDocumentFunctionOrder(raw);
    const sv = raw.schemaVersion;
    if (sv === BLUEPRINT_DOCUMENT_SCHEMA_VERSION) {
        return raw as BlueprintDocument;
    }
    if (
        typeof sv === "number"
        && sv >= BLUEPRINT_DOCUMENT_MIN_SUPPORTED_VERSION
        && sv < BLUEPRINT_DOCUMENT_SCHEMA_VERSION
        && isRecord(raw.blueprints)
    ) {
        const doc = { ...(raw as unknown as BlueprintDocument), schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION };
        if (sv < OWNER_KEY_ESCAPING_VERSION) {
            doc.ownerRecords = rewriteOwnerKeys(doc.ownerRecords);
        }
        if (sv < SHARED_ASSET_REMOVED_VERSION) {
            dropSharedAssetOwners(doc);
        }
        return doc;
    }
    throw new Error(
        `Unsupported BlueprintDocument schemaVersion: ${String(sv)}`
        + ` (v${BLUEPRINT_DOCUMENT_MIN_SUPPORTED_VERSION} is the oldest this Studio version reads)`,
    );
}

/**
 * The version at which every part of an owner key became percent-encoded.
 *
 * Named rather than inlined because the guard is the whole safety of this conversion: it reads a key
 * whose parts are raw and writes one whose parts are escaped, so running it on a key it has already
 * written would escape the escapes. `narraleaf-studio%3Amain-surface` would become
 * `narraleaf-studio%253Amain-surface`, the slot would look empty, a second blueprint would be minted
 * for it, and the author's would be orphaned. The version is what makes that unrepeatable.
 */
const OWNER_KEY_ESCAPING_VERSION = 11;

/**
 * The version at which the `sharedAsset` owner kind stopped existing.
 *
 * Gated like the escaping above, and for the same reason rather than the same danger: this pass is
 * idempotent, but a document already at the current version cannot contain what it removes, so
 * paying for the scan on every read would be the shape the four ungated param rewrites had.
 */
const SHARED_ASSET_REMOVED_VERSION = 12;

/**
 * Drop the blueprints and owner records left behind by the shared blueprint asset.
 *
 * **Dropped rather than left alone, because nothing downstream can hold one.** A shared blueprint
 * lived in a `.nlbp` file under `assets/content/` - a second storage location with no schema
 * version and no `ownerRecords` entry - and the owner kind naming it is gone. Every switch over
 * `BlueprintOwnerRef` is exhaustive, so a blueprint still carrying that owner does not sit inertly
 * in the map: `encodeBlueprintOwnerKey` falls past its last arm and hands back the owner object,
 * which reaches `assertValidBlueprintDocument` as an `[object Object]` key with no record and
 * refuses the whole document. Refusing a project over one record is the worse outcome of the two,
 * and the record is not the author's graph either way - shared blueprints were never written into
 * this document, and across twenty-eight authored projects plus the factory skeleton there were
 * zero `.nlbp` files, zero blueprint-category assets and zero `sharedAsset` owner records.
 *
 * The records that named those blueprints go with them, found by id rather than by reading the key.
 * `ownerRecords` described private slots only, so a record for a shared asset is a shape the format
 * allowed and no writer produced - but a record left pointing at a blueprint this sweep removed is
 * the one thing that would still refuse the document, and the validator already requires every id a
 * record lists to resolve. A record cannot list a mixture: its key has to equal the owner key of
 * every blueprint it lists, so one that names a dropped blueprint names nothing else.
 */
function dropSharedAssetOwners(doc: BlueprintDocument): void {
    if (!isRecord(doc.blueprints)) {
        return;
    }
    const dropped = new Set<string>();
    const blueprints: BlueprintDocument["blueprints"] = {};
    for (const [id, blueprint] of Object.entries(doc.blueprints)) {
        // `unknown` on purpose: the owner kind being removed is no longer part of `BlueprintOwnerRef`,
        // so the typed field cannot be compared against it. What is on disk is not what compiles.
        const owner: unknown = blueprint?.owner;
        if (isRecord(owner) && owner.kind === "sharedAsset") {
            dropped.add(id);
            continue;
        }
        blueprints[id] = blueprint;
    }
    if (dropped.size === 0) {
        return;
    }
    doc.blueprints = blueprints;
    if (isRecord(doc.ownerRecords)) {
        doc.ownerRecords = Object.fromEntries(
            Object.entries(doc.ownerRecords)
                .filter(([, record]) => !record.privateBlueprintIds?.some(id => dropped.has(id))),
        );
    }
}

/**
 * Rewrite the keys of `ownerRecords` into the escaped spelling, keeping every record's contents.
 *
 * **The records move; the blueprints do not.** A blueprint id is a hash of its owner key
 * (`derivedBlueprintId`), and the `ensure*` helpers mint a new blueprint whenever a slot's key finds
 * no record - so changing how keys are spelled without moving the records with them would present
 * every slot in every project as empty and orphan every private blueprint an author has written.
 * Ids are therefore carried across untouched: they stay the hashes of the old keys, which is
 * harmless, because nothing derives a key back from an id. The factory skeleton settles that
 * independently - none of its 220 blueprint ids equals its own key's hash, they are uuids from
 * before ids were derived at all, and they have always been read by lookup rather than recomputed.
 *
 * A key that cannot be read is left exactly as it is. Dropping it would delete an author's blueprint
 * over a spelling this code did not recognise; leaving it means one slot stays on the old key and is
 * found again the moment something can read it.
 */
function rewriteOwnerKeys(records: BlueprintDocument["ownerRecords"]): BlueprintDocument["ownerRecords"] {
    if (!isRecord(records)) {
        return records;
    }
    const rewritten: BlueprintDocument["ownerRecords"] = {};
    for (const [key, record] of Object.entries(records)) {
        const owner = decodeLegacyBlueprintOwnerKey(key);
        const next = owner ? encodeBlueprintOwnerKey(owner) : key;
        // A collision would mean two slots claiming one record, and the second write would silently
        // discard the first author's blueprint. Keeping the loser under its original key leaves both
        // readable, which is the outcome that loses nothing.
        rewritten[next in rewritten ? key : next] = record;
    }
    return rewritten;
}
