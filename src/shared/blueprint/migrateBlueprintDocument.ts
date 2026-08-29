/**
 * BlueprintDocument disk migration (shared between Workspace UIGraphService and main-process Dev Mode reads).
 *
 * ## Why there is nothing left to convert
 *
 * This used to open v2 through v9 and, on every read including a current one, run four param-level
 * rewrites that were never gated on a version: declarations becoming fields, persistent variables
 * leaving the document, `speed` becoming `cps`, `soundChannel` becoming an audio track. Each existed
 * for graphs written by a build of a product that has never shipped, and the last document that
 * could carry any of those shapes was written at v8 or earlier - except the sound one, whose window
 * at v10 was four days wide in July and left nothing behind on any project this repository has.
 *
 * So the floor is {@link BLUEPRINT_DOCUMENT_MIN_SUPPORTED_VERSION} and the rest is a stamp. v9 needs
 * no conversion to become v10: v10 only added `eventIds` / `functionIds`, the arrays that carry the
 * graph-slot order key order used to imply, and `reconcileOrder` already reads a document with no
 * arrays by falling back to key order - which for a v9 document IS the authored order.
 *
 * A document below the floor is refused by name rather than half-read.
 */
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { captureBlueprintDocumentEventOrder, captureBlueprintDocumentFunctionOrder } from "./blueprintEventOrder";

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
        return { ...(raw as unknown as BlueprintDocument), schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION };
    }
    throw new Error(
        `Unsupported BlueprintDocument schemaVersion: ${String(sv)}`
        + ` (v${BLUEPRINT_DOCUMENT_MIN_SUPPORTED_VERSION} is the oldest this Studio version reads)`,
    );
}
