/**
 * The impure half of the overview: gather what the pure model needs, once.
 *
 * Three sources, none of them new: the asset records (`AssetsService`), the reverse-lookup index
 * (`ReferenceService`, flushed first so a jump written a moment ago is counted), and a measurement of
 * the project's `assets/` directory for bytes. That measurement is a single `fs.directorySize` IPC -
 * the same recursive walk the game build runs (`Fs.directorySize`), so the "actual vs reachable"
 * comparison's left-hand side is exactly the number `GameBuildManager` would ship. It replaces an
 * earlier per-file walk (one `fs.list`/`fs.details` round trip per file), which on a project with
 * thousands of assets flooded the IPC channel and left the page spinning.
 *
 * One consequence of sharing the build's walk: it classifies with `Dirent`, so a symlink counts as
 * zero and a symlinked directory is not descended into - where the old per-file walk followed
 * symlinks to their target size. An `assets/` tree with hand-made symlinks therefore reads the way
 * the build packages it now, not larger. Nothing the editor writes creates one.
 *
 * Deliberately a one-shot snapshot rather than a live projection: the page reads it, it does not
 * depend on it being current to the keystroke. The tab re-runs it when it becomes visible again and
 * when the reference index changes.
 */

import {
  ProjectNameConvention,
  isValidAssetStorageId
} from "@/lib/workspace/project/nameConvention";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { ReferenceService } from "@/lib/workspace/services/references/ReferenceService";
import { type Asset } from "@/lib/workspace/services/assets/types";
import type { DirectorySizeResult } from "@shared/utils/fs";
import { buildAssetOverview, type AssetOverviewSummary } from "./assetOverviewModel";

/** How many rows the "largest" list keeps. Enough to see the hogs, short enough to read at once. */
const TOP_ASSET_COUNT = 12;

/**
 * Where an asset's bytes live inside `assets/`, as the directory walk keys them.
 *
 * Source-blind: a remote asset's snapshot is a file at the same content shard, and it takes up the
 * same room in the repository, so leaving it out of the overview would understate the project by
 * however much artwork the author happened to pin. An id that is not a valid storage id would throw
 * in the shard splitter, which means "no local bytes" and renders as unknown rather than zero.
 */
export function assetContentRelativePath(asset: Asset): string | null {
  if (!isValidAssetStorageId(asset.id)) {
    return null;
  }
  const shard = ProjectNameConvention.AssetsDataShard(asset.id);
  // `AssetsDataShard` is rooted at the project, and the walk is rooted at `assets/` - drop the
  // leading segment so the two agree.
  return shard.slice(1).join("/");
}

/**
 * Attribute the walk's per-file bytes back to asset ids.
 *
 * The one place the original bug lived: a file listed but addressed by the wrong (stem-only) path
 * counted as zero. Now the bytes arrive keyed by the walk's own relative paths, and an asset only
 * gets a byte count when its content path is actually among them - a missing content file leaves the
 * id absent (unknown bytes), never a spurious zero.
 */
export function assetBytesFromWalk(
  assets: readonly Asset[],
  bytesByRelativePath: DirectorySizeResult["bytesByRelativePath"]
): Map<string, number> {
  const bytesByAssetId = new Map<string, number>();
  for (const asset of assets) {
    const relative = assetContentRelativePath(asset);
    if (relative === null) {
      continue;
    }
    const bytes = bytesByRelativePath[relative];
    if (bytes !== undefined) {
      bytesByAssetId.set(asset.id, bytes);
    }
  }
  return bytesByAssetId;
}

export async function computeAssetOverviewSnapshot(
  ctx: WorkspaceContext
): Promise<AssetOverviewSummary> {
  const assetsService = ctx.services.get<AssetsService>(Services.Assets);
  const referenceService = ctx.services.get<ReferenceService>(Services.Reference);
  const fs = ctx.services.get<FileSystemService>(Services.FileSystem);

  const assets: Asset[] = Object.values(assetsService.getAssets()).flatMap(
    (byId) => Object.values(byId) as Asset[]
  );

  // The index must be both built and settled before it is read as an authority on what is
  // unused: a debounced rebuild left pending would report a just-used asset as an orphan, which
  // is the one mistake this page must not make.
  await referenceService.ensureReady();
  await referenceService.flushPendingRebuilds();
  const referencesByAssetId = referenceService.getReferencesForAll(assets.map((asset) => asset.id));
  const referenceCountByAssetId = new Map<string, number>();
  for (const [assetId, references] of referencesByAssetId) {
    referenceCountByAssetId.set(assetId, references.length);
  }

  // `ProjectNameConvention.Assets` carries a trailing slash (it names a directory); the walk
  // joins child names onto this string, so trim it the way the build's own `path.join` would.
  const assetsRoot = ctx.project.resolve(ProjectNameConvention.Assets).replace(/[\\/]+$/, "");
  const sizeResult = await fs.directorySize(assetsRoot);
  // A directory that cannot be measured reads as empty rather than taking the whole page down.
  const walk: DirectorySizeResult = sizeResult.ok
    ? sizeResult.data
    : { totalBytes: 0, fileCount: 0, bytesByRelativePath: {} };

  const bytesByAssetId = assetBytesFromWalk(assets, walk.bytesByRelativePath);

  return buildAssetOverview({
    assets,
    // Read after the same flush the counts came from, so coverage and counts describe one pass.
    indexResult: referenceService.getIndexResult(),
    bytesByAssetId,
    referenceCountByAssetId,
    directoryBytes: walk.totalBytes,
    directoryFileCount: walk.fileCount,
    topCount: TOP_ASSET_COUNT
  });
}
