/**
 * Pure projection: asset records + on-disk sizes + the reference index -> the overview readout.
 *
 * Everything here is derived. The overview owns no persisted data of its own: the asset list comes
 * from `AssetsService`, "who uses this" comes from `ReferenceService`, and the bytes come from a
 * walk of the project's `assets/` directory. Keeping the arithmetic in one React-free file is what
 * makes the numbers testable — and the numbers are the whole point of the page, because v2's
 * opt-in packaging trim is only allowed to exist once these have been audited against a real
 * project.
 *
 * Two words are used precisely throughout, and mean different things:
 *  - **referenced** — the reference index found at least one site holding this asset's id.
 *  - **reachable** — the bytes those referenced assets occupy. The *prediction*.
 * Neither changes what the build packages today; the build still ships the whole directory.
 */

import {
  ASSET_CATEGORY_ORDER,
  AssetCategory,
  categoryOfAssetType
} from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { referenceCoverageGapsFor } from "@/lib/workspace/services/assets/assetDeleteGuard";
import type { ReferenceIndexResult } from "@/lib/workspace/services/references/referenceModel";

/**
 * Fixed presentation order — the same sections the sidebar draws.
 *
 * Categories rather than types on purpose: this page and the tree are two views of one panel, and a
 * breakdown that split "Media" back into Audio and Videos would not reconcile against the counts in
 * the section headers three clicks away.
 */
export const ASSET_OVERVIEW_CATEGORY_ORDER: readonly AssetCategory[] = ASSET_CATEGORY_ORDER;

export interface AssetOverviewEntry {
  asset: Asset;
  /**
   * Bytes of the asset's content file, or `null` when there is no local file behind the record —
   * a remote asset (fetched by URL at runtime, cached under `editor/`), or a record whose content
   * file is missing. `null` is not `0`: one means "does not weigh anything here", the other would
   * claim we measured an empty file.
   */
  bytes: number | null;
  referenced: boolean;
  referenceCount: number;
  /**
   * Whether the index can answer "is this used?" for this asset at all.
   *
   * False and `referenced: false` is not an orphan - it is an unknown, and counting it as an
   * orphan is how this page tells an author to delete a file that something is still drawing.
   */
  usageKnown: boolean;
}

export interface AssetOverviewCategoryBucket {
  category: AssetCategory;
  count: number;
  bytes: number;
  referencedCount: number;
  referencedBytes: number;
}

export interface AssetOverviewGroupTotals {
  count: number;
  bytes: number;
}

/**
 * The packaging read-out. **Prediction only** — nothing here changes what a build packages, which
 * is still the entire `assets/` directory (`GameBuildManager`'s `directorySize` anchor).
 */
export interface AssetOverviewPackaging {
  /** Every byte under `assets/`, walked the way the build measures it. What ships today. */
  actualBytes: number;
  /** Bytes of the referenced assets alone. What would ship if the package followed references. */
  reachableBytes: number;
  /** `actualBytes - reachableBytes`: the difference between the two, never negative. */
  differenceBytes: number;
  /** Files walked under `assets/`, so a wildly-off `actualBytes` can be recognised as such. */
  fileCount: number;
}

export interface AssetOverviewSummary {
  total: AssetOverviewGroupTotals;
  referenced: AssetOverviewGroupTotals;
  /** The complement of the referenced set: nothing in the project points at these. */
  orphan: AssetOverviewGroupTotals;
  byCategory: AssetOverviewCategoryBucket[];
  /** Heaviest first; ties broken by name so the list does not shuffle between rebuilds. */
  largest: AssetOverviewEntry[];
  packaging: AssetOverviewPackaging;
  entries: AssetOverviewEntry[];
}

export interface AssetOverviewInput {
  assets: readonly Asset[];
  /** `assetId -> bytes` for assets with a local content file. Absent ids report `null` bytes. */
  bytesByAssetId: ReadonlyMap<string, number>;
  /** `assetId -> how many sites hold it`. Absent means unreferenced. */
  referenceCountByAssetId: ReadonlyMap<string, number>;
  /**
   * How far the index covers the project. Read per asset kind, so a picture the index cannot
   * identify does not turn every sound on the page into an unknown as well.
   */
  indexResult: ReferenceIndexResult;
  /** Total bytes under `assets/`, from the directory walk. */
  directoryBytes: number;
  directoryFileCount: number;
  /** How many rows the "largest" list keeps. */
  topCount: number;
}

/** `null` bytes contribute nothing to a total — see the note on {@link AssetOverviewEntry.bytes}. */
function weigh(entry: AssetOverviewEntry): number {
  return entry.bytes ?? 0;
}

function totals(entries: readonly AssetOverviewEntry[]): AssetOverviewGroupTotals {
  return {
    count: entries.length,
    bytes: entries.reduce((sum, entry) => sum + weigh(entry), 0)
  };
}

export function buildAssetOverview(input: AssetOverviewInput): AssetOverviewSummary {
  const entries: AssetOverviewEntry[] = input.assets.map((asset) => {
    const referenceCount = input.referenceCountByAssetId.get(asset.id) ?? 0;
    return {
      asset,
      bytes: input.bytesByAssetId.has(asset.id) ? input.bytesByAssetId.get(asset.id)! : null,
      referenced: referenceCount > 0,
      referenceCount,
      usageKnown: referenceCoverageGapsFor(input.indexResult, [asset.type]).length === 0
    };
  });

  const referenced = entries.filter((entry) => entry.referenced);
  // Unknown usage is deliberately in neither group: the orphan total drives a "you could save this
  // much" reading, and bytes it cannot vouch for do not belong in it.
  const orphan = entries.filter((entry) => !entry.referenced && entry.usageKnown);

  const byCategory = ASSET_OVERVIEW_CATEGORY_ORDER.map((category) => {
    const ofCategory = entries.filter(
      (entry) => categoryOfAssetType(entry.asset.type) === category
    );
    const referencedOfCategory = ofCategory.filter((entry) => entry.referenced);
    return {
      category,
      count: ofCategory.length,
      bytes: ofCategory.reduce((sum, entry) => sum + weigh(entry), 0),
      referencedCount: referencedOfCategory.length,
      referencedBytes: referencedOfCategory.reduce((sum, entry) => sum + weigh(entry), 0)
    };
  }).filter((bucket) => bucket.count > 0);

  const largest = [...entries]
    .sort((a, b) => weigh(b) - weigh(a) || a.asset.name.localeCompare(b.asset.name))
    .slice(0, Math.max(0, input.topCount));

  const reachableBytes = referenced.reduce((sum, entry) => sum + weigh(entry), 0);

  return {
    total: totals(entries),
    referenced: totals(referenced),
    orphan: totals(orphan),
    byCategory,
    largest,
    packaging: {
      actualBytes: input.directoryBytes,
      reachableBytes,
      // Clamped rather than allowed negative: the two numbers come from different sources
      // (a directory walk and a per-record lookup), and a directory that lost a file
      // mid-scan must read as "nothing to save", not as a negative saving.
      differenceBytes: Math.max(0, input.directoryBytes - reachableBytes),
      fileCount: input.directoryFileCount
    },
    entries
  };
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Byte count as a short, unit-suffixed string. Binary units, matching the build's own GiB check and
 * the asset property panel's KB/MB readouts — a page whose job is to be reconciled against those
 * two surfaces cannot quietly use a different base.
 */
export function formatByteSize(bytes: number | null): string {
  if (bytes === null) {
    return "—";
  }
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Whole bytes stay whole; anything scaled keeps one decimal, which is what the existing asset
  // readouts show and is enough to compare two rows at a glance.
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

/** Share of `total`, clamped to 0-100. `0` when there is no total to take a share of. */
export function byteShare(bytes: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (bytes / total) * 100));
}
