import type { FileDetails, FileStat, FileEntry } from "@shared/utils/fs";
import type { FsRequestResult } from "./os";
import type { FsTextEncoding } from "./textEncoding";
import type { PluginPermissionRequest } from "./pluginPermissions";

export const PrivilegedCapability = {
    FileSystemRead: "fs.read",
    FileSystemWrite: "fs.write",
    BashExecute: "bash.execute",
    PluginInstall: "plugin.install",
    PluginPermissionRequest: "plugin.permission.request",
} as const;

export type PrivilegedCapability = typeof PrivilegedCapability[keyof typeof PrivilegedCapability];

export type PrivilegedActor =
    | { kind: "facade"; id: "default" }
    | { kind: "plugin"; pluginId: string; version?: string };

export type PrivilegedFileSystemCall =
    /** `title` is the dialog's own title bar. Absent keeps the historical default, so existing callers
     *  are unaffected; every new caller should say what it is asking the author to pick. */
    | { operation: "selectFile"; filters: string[]; multiple: boolean; title?: string }
    | { operation: "selectSaveFile"; defaultFileName: string; filters: string[] }
    | { operation: "stat"; path: string }
    | { operation: "list"; path: string }
    | { operation: "details"; path: string }
    | { operation: "requestRead"; path: string; raw: false; encoding: FsTextEncoding }
    | { operation: "requestRead"; path: string; raw: true }
    /**
     * One read grant per path, minted in a single round trip.
     *
     * Every path is authorized individually, exactly as a `requestRead` for it alone would be,
     * and a path that is denied or missing comes back as `null` rather than refusing the
     * batch: unlike a write grant there is nothing shared between the answers, so a caller
     * resolving a library of assets wants the ones that worked.
     *
     * What it saves is the round trips. Resolving a project's assets asked for one grant at a
     * time, and on a 954-asset project that was 2.0s of a 4.4s Dev Mode boot spent almost
     * entirely on the wire rather than on the disk.
     */
    | { operation: "requestReadMany"; paths: string[]; raw: true }
    | { operation: "requestWrite"; path: string; raw: false; encoding: FsTextEncoding }
    | { operation: "requestWrite"; path: string; raw: true }
    /**
     * One grant covering N files, written together through a single `PUT`.
     *
     * Every path is authorized individually, exactly as a `requestWrite` for it alone would be, and
     * a single denial refuses the whole grant: a batch must never be a way to reach a path the
     * one-at-a-time route would have refused. What it *is* allowed to do is report per file - see
     * `decodeWriteBatchFrame` for the body and `FileSystemHashHandler.handleBatchWrite` for the
     * per-entry results.
     */
    | { operation: "requestWriteBatch"; entries: PrivilegedWriteBatchEntry[] }
    | { operation: "ensureRegularFile"; path: string; data: string; encoding?: BufferEncoding }
    | { operation: "writeFileNoFollow"; path: string; data: string; encoding?: BufferEncoding }
    /**
     * Write, creating the file if it is absent. See `Fs.writeFileNoFollowOrCreate`.
     *
     * Deliberately absent from the plugin-facing `app.fs` bridge (`IPCEventType.fs*`), which carries
     * the other two: this is here for Studio's own document services, and every verb added to that
     * surface is one more thing a plugin can be written against forever.
     */
    | { operation: "writeFileNoFollowOrCreate"; path: string; data: string; encoding?: BufferEncoding }
    | { operation: "createDir"; path: string }
    | { operation: "deleteFile"; path: string }
    | { operation: "deleteDir"; path: string }
    | { operation: "rename"; oldPath: string; newName: string; isDir: boolean }
    | { operation: "copyFile"; src: string; dest: string }
    | { operation: "copyDir"; src: string; dest: string }
    | { operation: "moveFile"; src: string; dest: string }
    | { operation: "moveDir"; src: string; dest: string }
    | { operation: "fileExists"; path: string }
    | { operation: "dirExists"; path: string }
    | { operation: "isFile"; path: string }
    | { operation: "isDir"; path: string }
    | { operation: "hash"; path: string };

/**
 * One file in a batched write grant.
 *
 * `encoding` absent means the payload is raw bytes, matching the `raw: true` arm of the single-path
 * verbs. It describes the *file*, never the wire; the frame is bytes either way.
 */
export type PrivilegedWriteBatchEntry = {
    path: string;
    encoding?: FsTextEncoding;
};

export type PrivilegedFileSystemCallPayload = PrivilegedFileSystemCall & {
    actor: PrivilegedActor;
};

export type PrivilegedFileSystemCallResult =
    | FsRequestResult<FileStat>
    | FsRequestResult<FileEntry[]>
    | FsRequestResult<FileDetails>
    | FsRequestResult<string>
    | FsRequestResult<string[]>
    /** requestReadMany: one grant per requested path, null where that path could not be granted. */
    | FsRequestResult<(string | null)[]>
    /** selectSaveFile: the chosen path, or null when the dialog was cancelled. */
    | FsRequestResult<string | null>
    | FsRequestResult<void>
    | FsRequestResult<boolean>;

export type PrivilegedPermissionRequestPayload = {
    actor: PrivilegedActor;
    request: PluginPermissionRequest;
};

export type PrivilegedPermissionRevokePluginPayload = {
    actor: PrivilegedActor;
    pluginId: string;
};

export type PrivilegedBashExecutePayload = {
    actor: PrivilegedActor;
    command: string;
    cwd?: string;
};

export type PrivilegedBashExecuteResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
};
