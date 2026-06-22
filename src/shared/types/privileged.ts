import type { FileDetails, FileStat } from "@shared/utils/fs";
import type { FsRequestResult } from "./os";
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
    | { kind: "plugin"; pluginId: string };

export type PrivilegedFileSystemCall =
    | { operation: "stat"; path: string }
    | { operation: "list"; path: string }
    | { operation: "details"; path: string }
    | { operation: "requestRead"; path: string; raw: false; encoding: BufferEncoding }
    | { operation: "requestRead"; path: string; raw: true }
    | { operation: "requestWrite"; path: string; raw: false; encoding: BufferEncoding }
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
    | FsRequestResult<FileStat[]>
    | FsRequestResult<FileDetails>
    | FsRequestResult<string>
    | FsRequestResult<void>
    | FsRequestResult<boolean>;

export type PrivilegedPermissionRequestPayload = {
    actor: PrivilegedActor;
    request: PluginPermissionRequest;
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
