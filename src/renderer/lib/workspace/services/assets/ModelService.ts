import { RequestStatus } from "@shared/types/ipcEvents";
import type { FileEntry } from "@shared/utils/fs";
import { entryFileName } from "@shared/utils/fileEntry";
import { join } from "@shared/utils/path";
import {
  MODEL_BUNDLE_MAX_DEPTH,
  MODEL_BUNDLE_MAX_FILES,
  detectModelBundleEntry,
  normalizeBundlePath,
  sortBundlePaths,
  type ModelBundleFormat
} from "@shared/utils/modelBundle";
import { AssetServiceBase } from "./AssetServiceBase";
import { AssetData, AssetType } from "./assetTypes";
import { Asset } from "./types";

/** One directory tree, read off disk. */
export interface ModelBundleListing {
  /** Relative, `/`-separated, in {@link sortBundlePaths} order. */
  files: string[];
  totalBytes: number;
}

/** What {@link ModelService.resolveEntry} decided, and why it could not decide. */
export interface ModelEntryResolution {
  /** Empty when unresolved. */
  entry: string;
  format: ModelBundleFormat;
  unresolved?: "ambiguous" | "none";
}

/**
 * Reads model bundles - the one asset type whose payload is a directory.
 *
 * Follows the `ImageService` / `JSONService` shape (an `AssetServiceBase` that turns what is at
 * `getAssetPath(asset.id)` into `AssetData`), with one difference that follows from the type: that
 * path is a *directory*, and "reading" a bundle means listing it, never loading it. Nothing here
 * opens a model file - the entry is inferred from the tree, and everything past that is the
 * engine's job.
 */
export class ModelService extends AssetServiceBase {
  /** The directory a bundle's files live under. Public so import/delete can address it too. */
  public getBundleRoot(assetId: string): string {
    return this.getAssetPath(assetId);
  }

  public async readLocalModel(
    asset: Asset<AssetType.Model>
  ): Promise<RequestStatus<AssetData<AssetType.Model>>> {
    const listing = await this.listBundle(this.getBundleRoot(asset.id));
    if (!listing.success || !listing.data) {
      return { success: false, error: listing.error ?? "Failed to read model bundle" };
    }

    const resolved = this.resolveEntry(asset, listing.data.files);
    return {
      success: true,
      data: {
        data: {
          entry: resolved.entry,
          files: listing.data.files,
          format: resolved.format,
          entryUnresolved: resolved.unresolved
        },
        metadata: {
          entry: resolved.entry,
          files: listing.data.files,
          size: listing.data.totalBytes
        }
      }
    };
  }

  /**
   * The entry to use for this record: the author's override when it still names a file that is
   * there, otherwise the detected one.
   *
   * The "still there" check is what keeps an override from outliving the file it names - replacing
   * a bundle's contents with a re-export whose manifest was renamed would otherwise leave the
   * record pointing at nothing, and a 404 at mount time is a much worse diagnostic than falling
   * back to detection.
   */
  public resolveEntry(
    asset: Asset<AssetType.Model>,
    files: readonly string[]
  ): ModelEntryResolution {
    const detection = detectModelBundleEntry(files);
    const formatOf = (path: string): ModelBundleFormat =>
      detection.candidates.find((candidate) => candidate.path === path)?.format ?? "unknown";

    const override = asset.extras?.modelEntry ? normalizeBundlePath(asset.extras.modelEntry) : null;
    if (override && files.includes(override)) {
      return { entry: override, format: formatOf(override) };
    }

    if (detection.entry) {
      return { entry: detection.entry, format: formatOf(detection.entry) };
    }

    return { entry: "", format: "unknown", unresolved: detection.reason ?? "none" };
  }

  /**
   * Walk a directory into the flat, sorted relative-path listing a bundle is described by.
   *
   * Every file is kept, with no extension filter. That is the whole point: the manifest is
   * authoritative about which files matter and Studio never reads it, so anything dropped here is
   * a texture or a motion that goes missing at runtime with no way to trace it back.
   *
   * Total bytes come from `directorySize`, which is one IPC round trip for the whole tree and the
   * same measurement the game build uses - rather than one `details` call per file.
   */
  public async listBundle(root: string): Promise<RequestStatus<ModelBundleListing>> {
    const filesystemService = this.getFileSystemService();
    const collected: string[] = [];
    let failure: string | null = null;

    const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
      if (failure || depth > MODEL_BUNDLE_MAX_DEPTH) {
        return;
      }
      const listed = await filesystemService.list(dir);
      if (!listed.ok) {
        failure = `Failed to list ${dir}: ${listed.error?.message ?? "unknown error"}`;
        return;
      }
      for (const entry of listed.data as FileEntry[]) {
        if (failure) {
          return;
        }
        const name = entryFileName(entry);
        const relative = prefix ? `${prefix}/${name}` : name;
        if (entry.type === "directory") {
          await walk(join(dir, name), relative, depth + 1);
          continue;
        }
        if (collected.length >= MODEL_BUNDLE_MAX_FILES) {
          failure = `Model bundle exceeds ${MODEL_BUNDLE_MAX_FILES} files`;
          return;
        }
        const normalized = normalizeBundlePath(relative);
        if (normalized) {
          collected.push(normalized);
        }
      }
    };

    await walk(root, "", 0);
    if (failure) {
      return { success: false, error: failure };
    }

    const size = await filesystemService.directorySize(root);
    return {
      success: true,
      data: {
        files: sortBundlePaths(collected),
        totalBytes: size.ok ? size.data.totalBytes : 0
      }
    };
  }
}
