import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { Fs } from "@shared/utils/fs";
import { FileStat, FileDetails } from "@shared/utils/fs";
import { FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import { dialog } from "electron";
import pathModule from "path";
import { getRuntimeGrantPolicy } from "../permissions";

function unauthorizedPathResult<T>(fsPath: string): FsRequestResult<T> {
    return {
        ok: false,
        error: {
            code: FsRejectErrorCode.PERMISSION_DENIED,
            message: `File system access is not allowed for path: ${fsPath}`
        }
    };
}

async function ensurePathAllowed<T>(window: AppWindow, fsPath: string, mode: "read" | "write"): Promise<FsRequestResult<T> | null> {
    if (await window.app.storageManager.isPathAllowed(window, fsPath, mode)) {
        return null;
    }
    return unauthorizedPathResult<T>(fsPath);
}

async function ensurePathsAllowed<T>(window: AppWindow, mode: "read" | "write", ...paths: string[]): Promise<FsRequestResult<T> | null> {
    for (const fsPath of paths) {
        const denied = await ensurePathAllowed<T>(window, fsPath, mode);
        if (denied) return denied;
    }
    return null;
}

export class FsStatHandler extends IPCHandler<IPCEventType.fsStat> {
    readonly name = IPCEventType.fsStat;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path }: IPCEvents[IPCEventType.fsStat]["data"]): Promise<RequestStatus<FsRequestResult<FileStat>>> {
        const denied = await ensurePathAllowed<FileStat>(window, path, "read");
        if (denied) return this.success(denied);

        const result = await Fs.stat(path);
        return this.success(result);
    }
}

export class FsListHandler extends IPCHandler<IPCEventType.fsList> {
    readonly name = IPCEventType.fsList;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path }: IPCEvents[IPCEventType.fsList]["data"]): Promise<RequestStatus<FsRequestResult<FileStat[]>>> {
        const denied = await ensurePathAllowed<FileStat[]>(window, path, "read");
        if (denied) return this.success(denied);

        // Use Fs.dirEntries to get all entries (files and directories)
        // Then convert to FileStat[] format to maintain compatibility
        const dirEntriesResult = await Fs.dirEntries(path);
        if (!dirEntriesResult.ok) {
            return this.success(dirEntriesResult as FsRequestResult<FileStat[]>);
        }

        // Convert Dirent[] to FileStat[]
        const fileStats: FileStat[] = dirEntriesResult.data.map(entry => ({
            name: pathModule.parse(entry.name).name,
            ext: pathModule.extname(entry.name) || null,
            type: entry.isDirectory() ? "directory" : "file",
        }));

        return this.success({
            ok: true,
            data: fileStats
        });
    }
}

export class FsDetailsHandler extends IPCHandler<IPCEventType.fsDetails> {
    readonly name = IPCEventType.fsDetails;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path }: IPCEvents[IPCEventType.fsDetails]["data"]): Promise<RequestStatus<FsRequestResult<FileDetails>>> {
        const denied = await ensurePathAllowed<FileDetails>(window, path, "read");
        if (denied) return this.success(denied);

        const result = await Fs.details(path);
        return this.success(result);
    }
}

export class FsRequestReadHandler extends IPCHandler<IPCEventType.fsRequestRead> {
    readonly name = IPCEventType.fsRequestRead;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path, raw, encoding }: IPCEvents[IPCEventType.fsRequestRead]["data"]): Promise<RequestStatus<FsRequestResult<string>>> {
        const denied = await ensurePathAllowed<string>(window, path, "read");
        if (denied) return this.success(denied);

        const hash = window.app.storageManager.allocateHash(path, raw, "read", encoding);

        window.app.logger.debug(`[fs.read] path="${path}", raw=${raw}, encoding=${encoding}`);

        try {
            // Check if file exists and is readable
            const existsResult = await Fs.isFileExists(path);
            if (!existsResult.ok) {
                window.app.storageManager.cleanup(hash);
                return this.success(existsResult as FsRequestResult<string>);
            }

            if (!existsResult.data) {
                window.app.storageManager.cleanup(hash);
                return this.success({
                    ok: false,
                    error: {
                        code: FsRejectErrorCode.NOT_FOUND,
                        message: "File does not exist: " + path
                    }
                });
            }

            // Check if we can access the file
            const accessResult = await Fs.isFile(path);
            if (!accessResult.ok) {
                window.app.storageManager.cleanup(hash);
                return this.success(accessResult as FsRequestResult<string>);
            }

            // File is available for reading, mark as ready
            window.app.storageManager.updateStatus(hash, 'ready');

            return this.success({
                ok: true,
                data: hash
            });
        } catch (error) {
            window.app.storageManager.cleanup(hash);
            return this.success({
                ok: false,
                error: {
                    code: FsRejectErrorCode.UNKNOWN,
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
}

export class FsRequestWriteHandler extends IPCHandler<IPCEventType.fsRequestWrite> {
    readonly name = IPCEventType.fsRequestWrite;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path, raw, encoding }: IPCEvents[IPCEventType.fsRequestWrite]["data"]): Promise<RequestStatus<FsRequestResult<string>>> {
        const denied = await ensurePathAllowed<string>(window, path, "write");
        if (denied) return this.success(denied);

        const hash = window.app.storageManager.allocateHash(path, raw, "write", encoding);

        window.app.logger.debug(`[fs.write] path="${path}", raw=${raw}, encoding=${encoding}`);

        try {
            // Check if directory exists and is writable
            const dirPath = require('path').dirname(path);
            const dirExistsResult = await Fs.isDirExists(dirPath);

            if (!dirExistsResult.ok) {
                window.app.storageManager.cleanup(hash);
                return this.success(dirExistsResult as FsRequestResult<string>);
            }

            if (!dirExistsResult.data) {
                window.app.storageManager.cleanup(hash);
                return this.success({
                    ok: false,
                    error: {
                        code: FsRejectErrorCode.NOT_FOUND,
                        message: "Directory does not exist"
                    }
                });
            }

            // Check if we can write to the target location (try to create a test file)
            const testPath = path + '.test';
            try {
                const writeResult = await Fs.write(testPath, '', encoding);
                if (writeResult.ok) {
                    // Clean up test file
                    await Fs.deleteFile(testPath);
                }
            } catch (error) {
                window.app.storageManager.cleanup(hash);
                return this.success({
                    ok: false,
                    error: {
                        code: FsRejectErrorCode.PERMISSION_DENIED,
                        message: "Cannot write to target location"
                    }
                });
            }

            // File is available for writing, mark as ready
            window.app.storageManager.updateStatus(hash, 'ready');

            return this.success({
                ok: true,
                data: hash
            });
        } catch (error) {
            window.app.storageManager.cleanup(hash);
            return this.success({
                ok: false,
                error: {
                    code: FsRejectErrorCode.UNKNOWN,
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
}

export class FsEnsureRegularFileHandler extends IPCHandler<IPCEventType.fsEnsureRegularFile> {
    readonly name = IPCEventType.fsEnsureRegularFile;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path, data, encoding }: IPCEvents[IPCEventType.fsEnsureRegularFile]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const denied = await ensurePathAllowed<void>(window, path, "write");
        if (denied) return this.success(denied);

        const result = await Fs.ensureRegularFile(path, data, encoding);
        return this.success(result);
    }
}

export class FsWriteFileNoFollowHandler extends IPCHandler<IPCEventType.fsWriteFileNoFollow> {
    readonly name = IPCEventType.fsWriteFileNoFollow;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path, data, encoding }: IPCEvents[IPCEventType.fsWriteFileNoFollow]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const denied = await ensurePathAllowed<void>(window, path, "write");
        if (denied) return this.success(denied);

        const result = await Fs.writeFileNoFollow(path, data, encoding);
        return this.success(result);
    }
}

export class FsRecoverCorruptedJsonFileHandler extends IPCHandler<IPCEventType.fsRecoverCorruptedJsonFile> {
    readonly name = IPCEventType.fsRecoverCorruptedJsonFile;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path, replacement, encoding }: IPCEvents[IPCEventType.fsRecoverCorruptedJsonFile]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const denied = await ensurePathAllowed<void>(window, path, "write");
        if (denied) return this.success(denied);

        const result = await Fs.recoverCorruptedJsonFile(path, replacement, encoding);
        return this.success(result);
    }
}

export class FsCreateDirHandler extends IPCHandler<IPCEventType.fsCreateDir> {
    readonly name = IPCEventType.fsCreateDir;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path }: IPCEvents[IPCEventType.fsCreateDir]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const denied = await ensurePathAllowed<void>(window, path, "write");
        if (denied) return this.success(denied);

        const result = await Fs.createDir(path);
        if (result.ok) {
            return this.success({ ok: true, data: undefined });
        } else {
            return this.success(result as FsRequestResult<void>);
        }
    }
}

export class FsDeleteFileHandler extends IPCHandler<IPCEventType.fsDeleteFile> {
    readonly name = IPCEventType.fsDeleteFile;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path }: IPCEvents[IPCEventType.fsDeleteFile]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const denied = await ensurePathAllowed<void>(window, path, "write");
        if (denied) return this.success(denied);

        const result = await Fs.deleteFile(path);
        return this.success(result);
    }
}

export class FsDeleteDirHandler extends IPCHandler<IPCEventType.fsDeleteDir> {
    readonly name = IPCEventType.fsDeleteDir;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path }: IPCEvents[IPCEventType.fsDeleteDir]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const denied = await ensurePathAllowed<void>(window, path, "write");
        if (denied) return this.success(denied);

        const result = await Fs.deleteDir(path);
        return this.success(result);
    }
}

export class FsRenameHandler extends IPCHandler<IPCEventType.fsRename> {
    readonly name = IPCEventType.fsRename;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { oldPath, newName, isDir }: IPCEvents[IPCEventType.fsRename]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const path = require('path');
        const newPath = path.join(path.dirname(oldPath), newName);
        const denied = await ensurePathsAllowed<void>(window, "write", oldPath, newPath);
        if (denied) return this.success(denied);

        const result = await Fs.rename(oldPath, newPath);
        return this.success(result);
    }
}

export class FsCopyFileHandler extends IPCHandler<IPCEventType.fsCopyFile> {
    readonly name = IPCEventType.fsCopyFile;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { src, dest }: IPCEvents[IPCEventType.fsCopyFile]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const readDenied = await ensurePathAllowed<void>(window, src, "read");
        if (readDenied) return this.success(readDenied);
        const writeDenied = await ensurePathAllowed<void>(window, dest, "write");
        if (writeDenied) return this.success(writeDenied);

        const result = await Fs.cpFile(src, dest);
        return this.success(result);
    }
}

export class FsCopyDirHandler extends IPCHandler<IPCEventType.fsCopyDir> {
    readonly name = IPCEventType.fsCopyDir;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { src, dest }: IPCEvents[IPCEventType.fsCopyDir]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const readDenied = await ensurePathAllowed<void>(window, src, "read");
        if (readDenied) return this.success(readDenied);
        const writeDenied = await ensurePathAllowed<void>(window, dest, "write");
        if (writeDenied) return this.success(writeDenied);

        const result = await Fs.copyDir(src, dest);
        return this.success(result);
    }
}

export class FsMoveFileHandler extends IPCHandler<IPCEventType.fsMoveFile> {
    readonly name = IPCEventType.fsMoveFile;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { src, dest }: IPCEvents[IPCEventType.fsMoveFile]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const readDenied = await ensurePathAllowed<void>(window, src, "read");
        if (readDenied) return this.success(readDenied);
        const writeDenied = await ensurePathsAllowed<void>(window, "write", src, dest);
        if (writeDenied) return this.success(writeDenied);

        const result = await Fs.moveFile(src, dest);
        return this.success(result);
    }
}

export class FsMoveDirHandler extends IPCHandler<IPCEventType.fsMoveDir> {
    readonly name = IPCEventType.fsMoveDir;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { src, dest }: IPCEvents[IPCEventType.fsMoveDir]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const readDenied = await ensurePathAllowed<void>(window, src, "read");
        if (readDenied) return this.success(readDenied);
        const writeDenied = await ensurePathsAllowed<void>(window, "write", src, dest);
        if (writeDenied) return this.success(writeDenied);

        const result = await Fs.moveDir(src, dest);
        return this.success(result);
    }
}

export class FsFileExistsHandler extends IPCHandler<IPCEventType.fsFileExists> {
    readonly name = IPCEventType.fsFileExists;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path }: IPCEvents[IPCEventType.fsFileExists]["data"]): Promise<RequestStatus<FsRequestResult<boolean>>> {
        const denied = await ensurePathAllowed<boolean>(window, path, "read");
        if (denied) return this.success(denied);

        const result = await Fs.isFileExists(path);
        return this.success(result);
    }
}

export class FsDirExistsHandler extends IPCHandler<IPCEventType.fsDirExists> {
    readonly name = IPCEventType.fsDirExists;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path }: IPCEvents[IPCEventType.fsDirExists]["data"]): Promise<RequestStatus<FsRequestResult<boolean>>> {
        const denied = await ensurePathAllowed<boolean>(window, path, "read");
        if (denied) return this.success(denied);

        const result = await Fs.isDirExists(path);
        if (result.ok) {
            return this.success({ ok: true, data: result.data });
        } else {
            return this.success(result as FsRequestResult<boolean>);
        }
    }
}

export class FsIsFileHandler extends IPCHandler<IPCEventType.fsIsFile> {
    readonly name = IPCEventType.fsIsFile;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path }: IPCEvents[IPCEventType.fsIsFile]["data"]): Promise<RequestStatus<FsRequestResult<boolean>>> {
        const denied = await ensurePathAllowed<boolean>(window, path, "read");
        if (denied) return this.success(denied);

        const result = await Fs.isFile(path);
        return this.success(result);
    }
}

export class FsIsDirHandler extends IPCHandler<IPCEventType.fsIsDir> {
    readonly name = IPCEventType.fsIsDir;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path }: IPCEvents[IPCEventType.fsIsDir]["data"]): Promise<RequestStatus<FsRequestResult<boolean>>> {
        const denied = await ensurePathAllowed<boolean>(window, path, "read");
        if (denied) return this.success(denied);

        const result = await Fs.isDir(path);
        return this.success(result);
    }
}

export class FsSelectFileHandler extends IPCHandler<IPCEventType.fsSelectFile> {
    readonly name = IPCEventType.fsSelectFile;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { filters, multiple }: IPCEvents[IPCEventType.fsSelectFile]["data"]): Promise<RequestStatus<FsRequestResult<string[]>>> {
        const grantPolicy = getRuntimeGrantPolicy(window, "selectFile");
        if (!grantPolicy) {
            return this.success(unauthorizedPathResult<string[]>("file picker"));
        }

        try {
            const dialogOptions: Electron.OpenDialogOptions = {
                title: "Select File",
                buttonLabel: "Select",
                properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
                securityScopedBookmarks: true,
            };

            // Convert filters from string[] to Electron dialog format
            if (filters && filters.length > 0) {
                dialogOptions.filters = [
                    {
                        name: "Filtered Files",
                        extensions: filters
                    },
                    {
                        name: "All Files",
                        extensions: ["*"]
                    }
                ];
            }

            const result = await dialog.showOpenDialog(window.win, dialogOptions);

            if (result.canceled) {
                return this.success({
                    ok: true,
                    data: []
                });
            }

            for (const [index, filePath] of result.filePaths.entries()) {
                window.app.storageManager.grantFileSystemAccess(window, filePath, grantPolicy.mode, grantPolicy.recursive, result.bookmarks?.[index]);
            }

            return this.success({
                ok: true,
                data: result.filePaths
            });
        } catch (error) {
            return this.success({
                ok: false,
                error: {
                    code: FsRejectErrorCode.UNKNOWN,
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
}

export class FsSelectDirectoryHandler extends IPCHandler<IPCEventType.fsSelectDirectory> {
    readonly name = IPCEventType.fsSelectDirectory;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { multiple }: IPCEvents[IPCEventType.fsSelectDirectory]["data"]): Promise<RequestStatus<FsRequestResult<string[]>>> {
        const grantPolicy = getRuntimeGrantPolicy(window, "selectDirectory");
        if (!grantPolicy) {
            return this.success(unauthorizedPathResult<string[]>("directory picker"));
        }

        try {
            const dialogOptions: Electron.OpenDialogOptions = {
                title: "Select Directory",
                buttonLabel: "Select",
                properties: multiple ? ["openDirectory", "multiSelections", "createDirectory"] : ["openDirectory", "createDirectory"],
                securityScopedBookmarks: true,
            };

            const result = await dialog.showOpenDialog(window.win, dialogOptions);

            if (result.canceled) {
                return this.success({
                    ok: true,
                    data: []
                });
            }

            for (const [index, dirPath] of result.filePaths.entries()) {
                window.app.storageManager.grantFileSystemAccess(window, dirPath, grantPolicy.mode, grantPolicy.recursive, result.bookmarks?.[index]);
            }

            return this.success({
                ok: true,
                data: result.filePaths
            });
        } catch (error) {
            return this.success({
                ok: false,
                error: {
                    code: FsRejectErrorCode.UNKNOWN,
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
}

export class FsGrantFileAccessHandler extends IPCHandler<IPCEventType.fsGrantFileAccess> {
    readonly name = IPCEventType.fsGrantFileAccess;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { paths }: IPCEvents[IPCEventType.fsGrantFileAccess]["data"]): Promise<RequestStatus<FsRequestResult<string[]>>> {
        const grantPolicy = getRuntimeGrantPolicy(window, "droppedFile");
        if (!grantPolicy) {
            return this.success(unauthorizedPathResult<string[]>("dropped file"));
        }

        const uniquePaths = Array.from(new Set(
            (Array.isArray(paths) ? paths : []).filter(path => typeof path === "string" && path.length > 0)
        ));
        const grantedPaths: string[] = [];

        for (const filePath of uniquePaths) {
            const fileCheck = await Fs.isFile(filePath);
            if (!fileCheck.ok) {
                return this.success(fileCheck as FsRequestResult<string[]>);
            }
            if (!fileCheck.data) {
                return this.success({
                    ok: false,
                    error: {
                        code: FsRejectErrorCode.NOT_A_FILE,
                        message: `Dropped path is not a file: ${filePath}`,
                    },
                });
            }

            window.app.storageManager.grantFileSystemAccess(window, filePath, grantPolicy.mode, grantPolicy.recursive);
            grantedPaths.push(filePath);
        }

        return this.success({
            ok: true,
            data: grantedPaths,
        });
    }
}

export class FsHashHandler extends IPCHandler<IPCEventType.fsHash> {
    readonly name = IPCEventType.fsHash;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path }: IPCEvents[IPCEventType.fsHash]["data"]): Promise<RequestStatus<FsRequestResult<string>>> {
        const denied = await ensurePathAllowed<string>(window, path, "read");
        if (denied) return this.success(denied);

        try {
            const fs = require('fs').promises;
            const crypto = require('crypto');

            // Check if file exists
            const existsResult = await Fs.isFileExists(path);
            if (!existsResult.ok || !existsResult.data) {
                return this.success({
                    ok: false,
                    error: {
                        code: FsRejectErrorCode.NOT_FOUND,
                        message: "File does not exist: " + path
                    }
                });
            }

            // Check if it's actually a file
            const isFileResult = await Fs.isFile(path);
            if (!isFileResult.ok || !isFileResult.data) {
                return this.success({
                    ok: false,
                    error: {
                        code: FsRejectErrorCode.NOT_A_FILE,
                        message: "Path is not a file: " + path
                    }
                });
            }

            // Read file content
            const buffer = await fs.readFile(path);

            // Calculate SHA-256 hash
            const hash = crypto.createHash('sha256').update(buffer).digest('hex');

            return this.success({
                ok: true,
                data: hash
            });
        } catch (error) {
            return this.success({
                ok: false,
                error: {
                    code: FsRejectErrorCode.UNKNOWN,
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
}
