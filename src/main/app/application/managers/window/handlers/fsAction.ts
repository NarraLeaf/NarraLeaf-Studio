import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { Fs } from "@shared/utils/fs";
import { FileStat, FileDetails } from "@shared/utils/fs";
import { FsRejectErrorCode, FsRequestResult } from "@shared/types/os";

export class FsStatHandler extends IPCHandler<IPCEventType.fsStat> {
    readonly name = IPCEventType.fsStat;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { path }: IPCEvents[IPCEventType.fsStat]["data"]): Promise<RequestStatus<FsRequestResult<FileStat>>> {
        const result = await Fs.stat(path);
        return this.success(result);
    }
}

export class FsListHandler extends IPCHandler<IPCEventType.fsList> {
    readonly name = IPCEventType.fsList;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { path }: IPCEvents[IPCEventType.fsList]["data"]): Promise<RequestStatus<FsRequestResult<FileStat[]>>> {
        const result = await Fs.listFiles(path);
        return this.success(result);
    }
}

export class FsDetailsHandler extends IPCHandler<IPCEventType.fsDetails> {
    readonly name = IPCEventType.fsDetails;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { path }: IPCEvents[IPCEventType.fsDetails]["data"]): Promise<RequestStatus<FsRequestResult<FileDetails>>> {
        const result = await Fs.details(path);
        return this.success(result);
    }
}

export class FsRequestReadHandler extends IPCHandler<IPCEventType.fsRequestRead> {
    readonly name = IPCEventType.fsRequestRead;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { path, raw, encoding }: IPCEvents[IPCEventType.fsRequestRead]["data"]): Promise<RequestStatus<FsRequestResult<string>>> {
        const hash = window.app.storageManager.allocateHash(path, raw, encoding);

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
        const hash = window.app.storageManager.allocateHash(path, raw, encoding);

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

export class FsCreateDirHandler extends IPCHandler<IPCEventType.fsCreateDir> {
    readonly name = IPCEventType.fsCreateDir;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { path }: IPCEvents[IPCEventType.fsCreateDir]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
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

    public async handle(_window: AppWindow, { path }: IPCEvents[IPCEventType.fsDeleteFile]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const result = await Fs.deleteFile(path);
        return this.success(result);
    }
}

export class FsDeleteDirHandler extends IPCHandler<IPCEventType.fsDeleteDir> {
    readonly name = IPCEventType.fsDeleteDir;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { path }: IPCEvents[IPCEventType.fsDeleteDir]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const result = await Fs.deleteDir(path);
        return this.success(result);
    }
}

export class FsRenameHandler extends IPCHandler<IPCEventType.fsRename> {
    readonly name = IPCEventType.fsRename;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { oldPath, newName, isDir }: IPCEvents[IPCEventType.fsRename]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const path = require('path');
        const newPath = path.join(path.dirname(oldPath), newName);
        const result = await Fs.rename(oldPath, newPath);
        return this.success(result);
    }
}

export class FsCopyFileHandler extends IPCHandler<IPCEventType.fsCopyFile> {
    readonly name = IPCEventType.fsCopyFile;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { src, dest }: IPCEvents[IPCEventType.fsCopyFile]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const result = await Fs.cpFile(src, dest);
        return this.success(result);
    }
}

export class FsCopyDirHandler extends IPCHandler<IPCEventType.fsCopyDir> {
    readonly name = IPCEventType.fsCopyDir;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { src, dest }: IPCEvents[IPCEventType.fsCopyDir]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const result = await Fs.copyDir(src, dest);
        return this.success(result);
    }
}

export class FsMoveFileHandler extends IPCHandler<IPCEventType.fsMoveFile> {
    readonly name = IPCEventType.fsMoveFile;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { src, dest }: IPCEvents[IPCEventType.fsMoveFile]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const result = await Fs.moveFile(src, dest);
        return this.success(result);
    }
}

export class FsMoveDirHandler extends IPCHandler<IPCEventType.fsMoveDir> {
    readonly name = IPCEventType.fsMoveDir;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { src, dest }: IPCEvents[IPCEventType.fsMoveDir]["data"]): Promise<RequestStatus<FsRequestResult<void>>> {
        const result = await Fs.moveDir(src, dest);
        return this.success(result);
    }
}

export class FsFileExistsHandler extends IPCHandler<IPCEventType.fsFileExists> {
    readonly name = IPCEventType.fsFileExists;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { path }: IPCEvents[IPCEventType.fsFileExists]["data"]): Promise<RequestStatus<FsRequestResult<boolean>>> {
        const result = await Fs.isFileExists(path);
        return this.success(result);
    }
}

export class FsDirExistsHandler extends IPCHandler<IPCEventType.fsDirExists> {
    readonly name = IPCEventType.fsDirExists;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { path }: IPCEvents[IPCEventType.fsDirExists]["data"]): Promise<RequestStatus<FsRequestResult<boolean>>> {
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

    public async handle(_window: AppWindow, { path }: IPCEvents[IPCEventType.fsIsFile]["data"]): Promise<RequestStatus<FsRequestResult<boolean>>> {
        const result = await Fs.isFile(path);
        return this.success(result);
    }
}

export class FsIsDirHandler extends IPCHandler<IPCEventType.fsIsDir> {
    readonly name = IPCEventType.fsIsDir;
    readonly type = IPCMessageType.request;

    public async handle(_window: AppWindow, { path }: IPCEvents[IPCEventType.fsIsDir]["data"]): Promise<RequestStatus<FsRequestResult<boolean>>> {
        const result = await Fs.isDir(path);
        return this.success(result);
    }
}