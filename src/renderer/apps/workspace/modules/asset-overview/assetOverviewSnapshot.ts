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

import { ProjectNameConvention, isValidAssetStorageId } from "@/lib/workspace/project/nameConvention";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { ReferenceService } from "@/lib/workspace/services/references/ReferenceService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
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
 * Files use the walk's relative paths. Model assets own a directory at their content path, so their
 * bytes are the sum of the files beneath it. Missing content stays unknown.
 */
export function assetBytesFromWalk(
    assets: readonly Asset[],
    bytesByRelativePath: DirectorySizeResult["bytesByRelativePath"],
): Map<string, number> {
    const bytesByAssetId = new Map<string, number>();
    const modelIdsByPath = new Map<string, string>();
    for (const asset of assets) {
        const relative = assetContentRelativePath(asset);
        if (relative === null) {
            continue;
        }
        if (asset.type === AssetType.Model) {
            modelIdsByPath.set(relative, asset.id);
        }
        const bytes = bytesByRelativePath[relative];
        if (bytes !== undefined) {
            bytesByAssetId.set(asset.id, bytes);
        }
    }
    if (modelIdsByPath.size > 0) {
        for (const [path, bytes] of Object.entries(bytesByRelativePath)) {
            let separator = path.lastIndexOf("/");
            while (separator > 0) {
                const assetId = modelIdsByPath.get(path.slice(0, separator));
                if (assetId !== undefined) {
                    bytesByAssetId.set(assetId, (bytesByAssetId.get(assetId) ?? 0) + bytes);
                    break;
                }
                separator = path.lastIndexOf("/", separator - 1);
            }
        }
    }
    return bytesByAssetId;
}

/**
 * Measure `assets/` on disk: the one expensive half of a snapshot.
 *
 * A single IPC, but the main process stats every file under the folder, which on a project of a
 * thousand files is most of a second. What it measures only changes when a file is added, replaced or
 * removed, so a caller keeps the result and hands it back to {@link computeAssetOverviewSnapshot}
 * until the library changes, rather than walking again every time the reference index moves.
 */
export async function walkAssetLibraryDirectory(ctx: WorkspaceContext): Promise<DirectorySizeResult> {
    const fs = ctx.services.get<FileSystemService>(Services.FileSystem);
    // `ProjectNameConvention.Assets` carries a trailing slash (it names a directory); the walk
    // joins child names onto this string, so trim it the way the build's own `path.join` would.
    const assetsRoot = ctx.project.resolve(ProjectNameConvention.Assets).replace(/[\\/]+$/, "");
    const sizeResult = await fs.directorySize(assetsRoot);
    // A directory that cannot be measured reads as empty rather than taking the whole page down.
    return sizeResult.ok
        ? sizeResult.data
        : { totalBytes: 0, fileCount: 0, bytesByRelativePath: {} };
}

/**
 * Read the library against the reference index and a measurement of the folder.
 *
 * `walk` is a measurement taken earlier by {@link walkAssetLibraryDirectory}; absent, the folder is
 * walked now. The bytes are attributed to the records as they are at this call either way, so a
 * record deleted since the walk simply drops out, and one added since reads as not measured.
 */
export async function computeAssetOverviewSnapshot(
    ctx: WorkspaceContext,
    walk?: DirectorySizeResult,
): Promise<{ summary: AssetOverviewSummary; walk: DirectorySizeResult }> {
    const assetsService = ctx.services.get<AssetsService>(Services.Assets);
    const referenceService = ctx.services.get<ReferenceService>(Services.Reference);

    const assets: Asset[] = Object.values(assetsService.getAssets()).flatMap(
        byId => Object.values(byId) as Asset[],
    );

    // The index must be both built and settled before it is read as an authority on what is
    // unused: a debounced rebuild left pending would report a just-used asset as an orphan, which
    // is the one mistake this page must not make.
    await referenceService.ensureReady();
    await referenceService.flushPendingRebuilds();
    const referencesByAssetId = referenceService.getReferencesForAll(assets.map(asset => asset.id));
    const indexResult = referenceService.getIndexResult();
    const referenceCountByAssetId = new Map<string, number>();
    for (const [assetId, references] of referencesByAssetId) {
        referenceCountByAssetId.set(assetId, references.length);
    }

    const measured = walk ?? await walkAssetLibraryDirectory(ctx);
    const bytesByAssetId = assetBytesFromWalk(assets, measured.bytesByRelativePath);

    const summary = buildAssetOverview({
        assets,
        indexResult,
        bytesByAssetId,
        referenceCountByAssetId,
        directoryBytes: measured.totalBytes,
        directoryFileCount: measured.fileCount,
        topCount: TOP_ASSET_COUNT,
    });
    return { summary, walk: measured };
}
