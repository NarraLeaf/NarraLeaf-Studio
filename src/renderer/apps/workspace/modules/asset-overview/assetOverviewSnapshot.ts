/**
 * The impure half of the overview: gather what the pure model needs, once.
 *
 * Three sources, none of them new: the asset records (`AssetsService`), the reverse-lookup index
 * (`ReferenceService`, flushed first so a jump written a moment ago is counted), and a walk of the
 * project's `assets/` directory for bytes. The walk is what the build measures too - the
 * "actual vs reachable" comparison is only worth reading if its left-hand side is the same number
 * `GameBuildManager` would arrive at, so it counts every file under the directory rather than only
 * the ones the asset records claim.
 *
 * Deliberately a one-shot snapshot rather than a live projection: it costs one `stat` per file, and
 * the page reads it, it does not depend on it being current to the keystroke. The tab re-runs it
 * when it becomes visible again and when the reference index changes.
 */

import { ProjectNameConvention, isValidAssetStorageId } from "@/lib/workspace/project/nameConvention";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { ReferenceService } from "@/lib/workspace/services/references/ReferenceService";
import { AssetSource, type Asset } from "@/lib/workspace/services/assets/types";
import { join } from "@shared/utils/path";
import { buildAssetOverview, type AssetOverviewSummary } from "./assetOverviewModel";

/** How many rows the "largest" list keeps. Enough to see the hogs, short enough to read at once. */
const TOP_ASSET_COUNT = 12;

/**
 * Concurrent `stat`/`readdir` calls in flight. Each one is an IPC round trip; unbounded fan-out on a
 * project with thousands of assets floods the channel and starves the rest of the UI's traffic.
 */
const WALK_CONCURRENCY = 16;

/** A directory that will not open is reported as empty rather than failing the whole snapshot. */
interface DirectoryWalk {
    totalBytes: number;
    fileCount: number;
    /** Path relative to the walked root, joined with `/`. */
    bytesByRelativePath: Map<string, number>;
}

async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await fn(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}

/**
 * Total the bytes of a directory tree, breadth-first.
 *
 * Mirrors `GameBuildManager.directorySize`: a directory that cannot be read counts as empty, and a
 * file whose size cannot be read counts as zero, because a build that would still ship those bytes
 * must not be reported as smaller than it is - and refusing to produce a number at all would take
 * the whole page down over one unreadable file.
 */
export async function walkDirectoryBytes(fs: FileSystemService, root: string): Promise<DirectoryWalk> {
    const walk: DirectoryWalk = { totalBytes: 0, fileCount: 0, bytesByRelativePath: new Map() };
    let level: Array<{ path: string; relative: string }> = [{ path: root, relative: "" }];

    while (level.length > 0) {
        const listings = await mapWithLimit(level, WALK_CONCURRENCY, async directory => {
            const result = await fs.list(directory.path);
            return { directory, entries: result.ok ? result.data : [] };
        });

        const nextLevel: Array<{ path: string; relative: string }> = [];
        const files: Array<{ path: string; relative: string }> = [];
        for (const { directory, entries } of listings) {
            for (const entry of entries) {
                const child = {
                    path: join(directory.path, entry.name),
                    relative: directory.relative ? `${directory.relative}/${entry.name}` : entry.name,
                };
                if (entry.type === "directory") {
                    nextLevel.push(child);
                } else {
                    files.push(child);
                }
            }
        }

        await mapWithLimit(files, WALK_CONCURRENCY, async file => {
            const details = await fs.details(file.path);
            const size = details.ok && Number.isFinite(details.data.size) ? Math.max(0, details.data.size) : 0;
            walk.totalBytes += size;
            walk.fileCount += 1;
            walk.bytesByRelativePath.set(file.relative, size);
        });

        level = nextLevel;
    }

    return walk;
}

/**
 * Where an asset's bytes live inside `assets/`, as the walk keys them.
 *
 * Remote assets have no content file at all (they are fetched by URL and cached under `editor/`),
 * and an id that is not a valid storage id would throw in the shard splitter - both mean "no local
 * bytes", which the model renders as unknown rather than zero.
 */
export function assetContentRelativePath(asset: Asset): string | null {
    if (asset.source === AssetSource.Remote || !isValidAssetStorageId(asset.id)) {
        return null;
    }
    const shard = ProjectNameConvention.AssetsDataShard(asset.id);
    // `AssetsDataShard` is rooted at the project, and the walk is rooted at `assets/` - drop the
    // leading segment so the two agree.
    return shard.slice(1).join("/");
}

export async function computeAssetOverviewSnapshot(ctx: WorkspaceContext): Promise<AssetOverviewSummary> {
    const assetsService = ctx.services.get<AssetsService>(Services.Assets);
    const referenceService = ctx.services.get<ReferenceService>(Services.Reference);
    const fs = ctx.services.get<FileSystemService>(Services.FileSystem);

    const assets: Asset[] = Object.values(assetsService.getAssets()).flatMap(
        byId => Object.values(byId) as Asset[],
    );

    // The index must be both built and settled before it is read as an authority on what is
    // unused: a debounced rebuild left pending would report a just-used asset as an orphan, which
    // is the one mistake this page must not make.
    await referenceService.ensureReady();
    await referenceService.flushPendingRebuilds();
    const referencesByAssetId = referenceService.getReferencesForAll(assets.map(asset => asset.id));
    const referenceCountByAssetId = new Map<string, number>();
    for (const [assetId, references] of referencesByAssetId) {
        referenceCountByAssetId.set(assetId, references.length);
    }

    // `ProjectNameConvention.Assets` carries a trailing slash (it names a directory); the walk
    // joins child names onto this string, so trim it the way the build's own `path.join` would.
    const assetsRoot = ctx.project.resolve(ProjectNameConvention.Assets).replace(/[\\/]+$/, "");
    const walk = await walkDirectoryBytes(fs, assetsRoot);

    const bytesByAssetId = new Map<string, number>();
    for (const asset of assets) {
        const relative = assetContentRelativePath(asset);
        const bytes = relative === null ? undefined : walk.bytesByRelativePath.get(relative);
        if (bytes !== undefined) {
            bytesByAssetId.set(asset.id, bytes);
        }
    }

    return buildAssetOverview({
        assets,
        bytesByAssetId,
        referenceCountByAssetId,
        directoryBytes: walk.totalBytes,
        directoryFileCount: walk.fileCount,
        topCount: TOP_ASSET_COUNT,
    });
}
