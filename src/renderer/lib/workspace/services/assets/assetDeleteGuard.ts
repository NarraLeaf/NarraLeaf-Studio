import {
    referenceGapsAffecting,
    type AssetReference,
    type ReferenceAssetKind,
    type ReferenceIndexGap,
    type ReferenceIndexResult,
} from "../references/referenceModel";
import { AssetType } from "./assetTypes";

/**
 * Which kind of doubt an asset of this type can be caught by.
 *
 * Exhaustive rather than defaulted, so a new asset type has to be given an answer here instead of
 * quietly inheriting "nothing can hide this one". A type no gap can describe returns null and is
 * only ever held back by a gap that names no kinds at all.
 */
export function referenceAssetKindOf(assetType: AssetType): ReferenceAssetKind | null {
    switch (assetType) {
        case AssetType.Image:
            return "image";
        case AssetType.Font:
            return "font";
        case AssetType.Audio:
        case AssetType.Video:
        case AssetType.JSON:
        case AssetType.Blueprint:
        case AssetType.Model:
        case AssetType.Other:
            return null;
    }
}

/**
 * The single answer to "can the index say whether these assets are used?".
 *
 * Every readout that prints "not used" and every guard that acts on it goes through here, because
 * the alternative is four places each deciding for themselves — and the failure they would make is
 * silent: an asset with no references and no coverage looks exactly like an unused one.
 */
export function referenceCoverageGapsFor(
    result: ReferenceIndexResult,
    assetTypes: readonly AssetType[],
): ReferenceIndexGap[] {
    const kinds = assetTypes
        .map(referenceAssetKindOf)
        .filter((kind): kind is ReferenceAssetKind => kind !== null);
    return referenceGapsAffecting(result.gaps, kinds);
}

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
    /**
     * The types of the assets being asked about. A gap is only held against a question it could
     * actually be hiding the answer to: a widget with an unreadable picture says nothing about
     * whether a sound is used, and holding it against every asset would make one pasted URL
     * enough to put the whole library beyond deleting.
     */
    assetTypes: readonly AssetType[] = [],
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
        // Read after the flush, so the coverage answer describes the same pass the references came
        // from. An index that cannot cover these assets cannot say they are unused, and this guard
        // exists for exactly that sentence.
        const gaps = referenceCoverageGapsFor(lookup.getIndexResult(), assetTypes);
        return gaps.length === 0
            ? { checked: true, references }
            : { checked: false, references, gaps };
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
