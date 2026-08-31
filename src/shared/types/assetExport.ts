/**
 * Exporting library files back out to disk.
 *
 * The shapes crossing the IPC boundary for {@link IPCEventType.assetExportToFolder}, which copies a
 * selection into a chosen folder, and {@link IPCEventType.assetExportToFile}, which saves a single
 * file under a name the author types. An asset's bytes live under an id-sharded path with no
 * extension, so both halves of the answer - which file to read, and what it should be called once
 * it is out of the project - come from the renderer, which is the only side that holds the library
 * records.
 */

/** One file (or bundle directory) to copy out. */
export interface AssetExportEntry {
    /** Absolute path of the source, inside the project. Main refuses anything it may not read. */
    sourcePath: string;
    /**
     * Where it lands, relative to the chosen folder, `/`-separated.
     *
     * Carries the author-facing filename *and* any folder structure a selected group contributes.
     * Main sanitizes every segment and refuses anything that would escape the chosen folder.
     */
    relativePath: string;
    /** Bundle assets (models) are directories, and are copied recursively. */
    isDirectory?: boolean;
}

/** What could not be copied, named by where it was going rather than by its shard path. */
export interface AssetExportFailure {
    relativePath: string;
    reason: string;
}

export interface AssetExportResult {
    canceled: boolean;
    /** The folder the author picked. Absent when they dismissed the dialog. */
    directory?: string;
    /** How many entries landed. Files that had to be renamed around a collision still count. */
    exportedCount?: number;
    failures?: AssetExportFailure[];
}

/** One file to copy out under a name the author types in a save dialog. */
export interface AssetExportFileEntry {
    /** Absolute path of the source, inside the project. Main refuses anything it may not read. */
    sourcePath: string;
    /** The name the dialog opens with. Main sanitizes it and the author may replace it outright. */
    fileName: string;
}

export interface AssetExportFileResult {
    canceled: boolean;
    /** Where the file landed, under the name the author gave it. Absent when they dismissed. */
    filePath?: string;
}
