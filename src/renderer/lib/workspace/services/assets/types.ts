import type { AudioClipRegion } from "@shared/types/audio";
import { AssetCategory, AssetType } from "./assetTypes";

export enum AssetSource {
  Local = "local",
  Remote = "remote"
}

/**
 * A remote asset's provenance: where its bytes came from, and what the server said about them.
 *
 * The bytes themselves are **not** here and are not remote at read time. A remote asset is a *pinned
 * reference*: the snapshot lives at the same content shard as any local asset and travels with the
 * project under version control, and this record is what makes a later "check for updates" possible.
 * Everything downstream - the build, the lint rules, thumbnails, the overview - therefore treats a
 * remote asset as an ordinary one.
 */
export type AssetResolveMeta<Source extends AssetSource> = Source extends AssetSource.Local
  ? {}
  : Source extends AssetSource.Remote
    ? {
        /** The address the author gave, verbatim. The only field a refresh sends a request to. */
        url: string;
        /** When the stored snapshot was taken, ISO 8601. */
        fetchedAt: string;
        /**
         * The server's validators for the stored snapshot, when it offered any. Sent back as
         * `If-None-Match` / `If-Modified-Since`, so refreshing an unchanged asset transfers no bytes.
         */
        etag?: string;
        lastModified?: string;
        /** The response's declared media type. Diagnostic only - the format gate reads the bytes. */
        contentType?: string;
        /**
         * Was to be the runtime cache lifetime, back when a remote asset was going to be fetched by the
         * shipped game. It never was: the runtime asset manifest carries no URL, so a packaged game has
         * only the baked bytes, and nothing has ever read this. Kept so records that carry it still
         * open; the next write drops it. Never write it.
         *
         * @deprecated
         */
        lifetime?: number;
      }
    : never;

/**
 * Asset interface with user metadata
 * Stored in assets metadata files
 */
export interface Asset<
  Type extends AssetType = AssetType,
  Source extends AssetSource = AssetSource
> {
  id: string; // Unique identifier (UUID) used for indexing and file storage
  type: Type;
  name: string;
  hash: string; // File hash (read-only)
  ext?: string;
  source: Source;
  meta: AssetResolveMeta<Source>;
  tags: string[];
  description: string;
  groupId?: string;
  /**
   * Editor-authored data that rides with the asset record. Persisted in the assets metadata,
   * which is a project file under version control - so this is for things the *author* decided
   * (and would want to keep and share), never for derived caches. Anything recomputable belongs
   * under {@link ProjectNameConvention.EditorThumbnailCache}'s neighbours in `editor/cache/`.
   */
  extras?: AssetExtras;
}

/**
 * The points the author marked on an audio asset - where a BGM starts, where it ends, and where
 * each repeat returns to.
 *
 * One region per asset, not a list of markers: a clip has exactly one region worth naming, and the
 * thing downstream wants to ask is "where does this loop", which a bag of markers cannot answer.
 * Any marker may stand alone while the author is still deciding.
 *
 * The same shape the game bundle carries ({@link AudioClipRegion}) - deliberately one type, because
 * the region an author marks here is the region the engine plays. `@shared/types/audio` owns the
 * normalizer both sides read it with.
 */
export type AssetAudioLoop = AudioClipRegion;

export interface AssetExtras {
  /** Audio only: the loop region shown and edited by the audio preview. */
  audioLoop?: AssetAudioLoop;
  /**
   * Model bundles only: the entry file the author chose, relative to the bundle root.
   *
   * The only part of a bundle that is persisted rather than re-read from disk, because it is the
   * only part that is a *decision*. `files` and `size` are observations and are recomputed on
   * every read; the entry is a guess Studio made from the file tree that the author may have
   * corrected, and a guess that silently re-runs would undo the correction.
   *
   * Absent means "use the detected entry" - so a bundle whose detection is unambiguous carries no
   * extra state at all, and re-detection keeps working if a later Studio learns a new format.
   */
  modelEntry?: string;
  /**
   * Text assets only: the encoding the author said this file is in.
   *
   * A property of the *file*, not of the window, which is why it rides the record into version
   * control rather than sitting in session state: the point of a shared plan file is that the
   * colleague who opens the GBK spreadsheet next gets it right without having to know. Outranks
   * the byte-order-mark sniff on open, because an author who said so has said more than a
   * heuristic can.
   *
   * Written only when the author explicitly reopens or saves under an encoding. Absent - the
   * normal state - means "sniff the BOM, then UTF-8", so merely reading a file never produces a
   * change to commit.
   */
  textEncoding?: import("@shared/types/textEncoding").TextEncodingId;
  /**
   * Text assets only: the line ending this file uses.
   *
   * Recorded for the same reason as {@link textEncoding}, and needed at all because a *new* text
   * file is zero bytes: there is nothing in the content to detect, so the platform that created it
   * is the only thing that can answer. For a file that has content, the content wins - see
   * `resolveLineEnding` - and this is only the fallback.
   */
  textEol?: import("@shared/types/textEncoding").PersistedTextEol;
  /**
   * Superseded by {@link audioLoop}, which replaced a free list of markers with the one in/out
   * pair a clip actually has. Read only so records written by the short-lived cue-point model
   * still open with their points intact - the editor rewrites them as `audioLoop` on the next
   * edit and clears this. Never write it.
   *
   * @deprecated
   */
  cuePoints?: { timeMs: number }[];
}

export type AssetsMap = {
  [K in AssetType]: Record<string, Asset<K, AssetSource>>;
};

/**
 * A folder in the asset browser.
 *
 * Filed under a {@link AssetCategory}, not an {@link AssetType}: the sidebar's sections are
 * categories, and a folder under "Media" has to be able to hold an mp3 next to an mp4. Records
 * written before this carried `type: AssetType` instead and are folded up on read; the id never
 * changed, so no asset's `groupId` had to be rewritten.
 */
export interface AssetGroup {
  id: string;
  name: string;
  category: AssetCategory;
  parentGroupId?: string;
  createdAt: number;
  updatedAt: number;
}

/** A group record as it may still exist on disk, from before groups moved up to categories. */
export interface LegacyTypedAssetGroup extends Omit<AssetGroup, "category"> {
  category?: AssetCategory;
  type?: AssetType;
}

/**
 * Group map organized by asset category
 */
export type AssetGroupMap = {
  [K in AssetCategory]: Record<string, AssetGroup>;
};
