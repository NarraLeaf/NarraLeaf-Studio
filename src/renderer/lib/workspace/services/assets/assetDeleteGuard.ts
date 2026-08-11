import type { AssetReference, ReferenceIndexGap, ReferenceIndexResult } from "../references/referenceModel";

/**
 * The slice of `ReferenceService` the delete guard needs. Named separately so the guard can be
 * exercised without standing up the whole reference index, and so the dependency stays one-way:
 * `AssetsService` reaches the reference index through the service registry at call time, never
 * through an import (`ReferenceService` scans documents that themselves read assets).
 */
export interface AssetReferenceLookup {
    ensureReady(): Promise<void>;
    flushPendingRebuilds(): Promise<void>;
    getReferencesForAll(assetIds: readonly string[]): Map<string, AssetReference[]>;
    getIndexResult(): ReferenceIndexResult;
}

export interface AssetReferenceReport {
    /**
     * Whether the index could be consulted at all. "Nothing uses this" and "I could not find out"
     * are different answers, and an unbuilt index reports every asset in the project as unused —
     * so the second one must never be allowed to read as the first.
     *
     * An index that built but does not cover the whole project counts as not checked, and this is
     * the point of the whole coverage signal: a document holding an asset the index could not
     * identify is precisely the document that would lose its picture to this delete.
     */
    checked: boolean;
    /** `assetId → references`, only for assets that have at least one. */
    references: Map<string, AssetReference[]>;
    /** Where coverage stops, when `checked` is false because of a gap rather than a failure. */
    gaps?: readonly ReferenceIndexGap[];
}

export interface AssetDeleteOptions {
    /**
     * The author has seen what still points at these assets and chose to go ahead — the ruling is
     * "warn, do not block": sometimes deleting the referenced file is exactly the intent (they are
     * about to replace the thing that uses it).
     *
     * Only a caller that actually asked may set this. It is the single door through the guard, which
     * is why the guard lives in the service and not in the panel that draws the dialog.
     */
    allowReferenced?: boolean;
}

/**
 * Read the reverse-lookup index for a set of assets, forcing it up to date first.
 *
 * `ensureReady` because the index is lazy — in a project whose stories were never opened it starts
 * empty, and an empty index calls everything deletable. `flushPendingRebuilds` because it is
 * debounced by 300ms, and an author who drops an image into a scene and then deletes it from the
 * browser a second later is exactly the case the guard exists for.
 */
export async function collectAssetReferences(
    lookup: AssetReferenceLookup | null,
    assetIds: readonly string[],
): Promise<AssetReferenceReport> {
    if (assetIds.length === 0) {
        return { checked: true, references: new Map() };
    }
    if (!lookup) {
        return { checked: false, references: new Map() };
    }

    try {
        await lookup.ensureReady();
        await lookup.flushPendingRebuilds();
        const references = lookup.getReferencesForAll(assetIds);
        const result = lookup.getIndexResult();
        // Read after the flush, so the coverage answer describes the same pass the references came
        // from. An index that is not complete cannot say an asset is unused, and this guard exists
        // for exactly that sentence.
        return result.complete
            ? { checked: true, references }
            : { checked: false, references, gaps: result.gaps };
    } catch {
        return { checked: false, references: new Map() };
    }
}

/**
 * Why a delete was refused, as a diagnostic string for the `RequestStatus.error` channel.
 *
 * Not user-facing copy and not localized on purpose: the panel draws its own dialog with the
 * reference list before it ever calls through with `allowReferenced`, so anything that surfaces this
 * text is a caller that skipped the ask — a log line, not a sentence for an author.
 */
export function describeBlockedDelete(report: AssetReferenceReport, nameById: Map<string, string>): string {
    if (!report.checked) {
        const where = report.gaps
            ?.map(gap => gap.location)
            .filter((location): location is string => Boolean(location));
        // The locations are what makes this actionable: an author who is told the index is
        // incomplete can do nothing, while one who is told which widget holds an unidentifiable
        // picture can go and fix it.
        return where?.length
            ? `Refusing to delete: the reference index does not cover ${where.join(", ")}, so it is unknown whether anything still points at these assets.`
            : "Refusing to delete: the reference index could not be read, so it is unknown whether anything still points at these assets.";
    }

    const lines = [...report.references.entries()].map(([assetId, references]) => {
        const name = nameById.get(assetId) ?? assetId;
        return `${name}: ${references.map(reference => reference.label).join(", ")}`;
    });
    return `Refusing to delete assets that are still in use — ${lines.join("; ")}`;
}
