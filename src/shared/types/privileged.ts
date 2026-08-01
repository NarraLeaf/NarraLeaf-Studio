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
    | { operation: "requestWrite"; path: string; raw: false; encoding: FsTextEncoding }
    | { operation: "requestWrite"; path: string; raw: true }
    | { operation: "ensureRegularFile"; path: string; data: string; encoding?: BufferEncoding }
    | { operation: "writeFileNoFollow"; path: string; data: string; encoding?: BufferEncoding }
    | { operation: "recoverCorruptedJsonFile"; path: string; replacement: string; encoding?: BufferEncoding }
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

export type PrivilegedFileSystemCallPayload = PrivilegedFileSystemCall & {
    actor: PrivilegedActor;
};

export type PrivilegedFileSystemCallResult =
    | FsRequestResult<FileStat>
    | FsRequestResult<FileEntry[]>
    | FsRequestResult<FileDetails>
    | FsRequestResult<string>
    | FsRequestResult<string[]>
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
