import type { AssetReference } from "../references/referenceModel";

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
}

export interface AssetReferenceReport {
    /**
     * Whether the index could be consulted at all. "Nothing uses this" and "I could not find out"
     * are different answers, and an unbuilt index reports every asset in the project as unused —
     * so the second one must never be allowed to read as the first.
     */
    checked: boolean;
    /** `assetId → references`, only for assets that have at least one. */
    references: Map<string, AssetReference[]>;
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
        return { checked: true, references: lookup.getReferencesForAll(assetIds) };
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
        return "Refusing to delete: the reference index could not be read, so it is unknown whether anything still points at these assets.";
    }

    const lines = [...report.references.entries()].map(([assetId, references]) => {
        const name = nameById.get(assetId) ?? assetId;
        return `${name}: ${references.map(reference => reference.label).join(", ")}`;
    });
    return `Refusing to delete assets that are still in use — ${lines.join("; ")}`;
}
