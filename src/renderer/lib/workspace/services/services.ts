import { FsRequestResult } from "@shared/types/os";
import { FileDetails, FileStat } from "@shared/utils/fs";

interface WorkspaceContext {}

interface IService {
    init(ctx: WorkspaceContext): Promise<void> | void;
    activate(ctx: WorkspaceContext): Promise<void> | void;
    dispose(ctx: WorkspaceContext): Promise<void> | void;
}

abstract class Service implements IService {
    private ctx: WorkspaceContext | null = null;

    public setContext(ctx: WorkspaceContext): void {
        this.ctx = ctx;
    }

    public getContext(): WorkspaceContext | null {
        if (!this.ctx) {
            throw new Error("Trying to access context of a service before initialization");
        }
        return this.ctx;
    }

    public init(ctx: WorkspaceContext): Promise<void> | void {
        this.setContext(ctx);
    }

    public activate(_ctx: WorkspaceContext): Promise<void> | void {}

    public dispose(_ctx: WorkspaceContext): Promise<void> | void {}
}

// Core Services
interface IFileSystemService extends IService {
    stat(path: string): Promise<FsRequestResult<FileStat>>;
    list(path: string): Promise<FsRequestResult<FileStat[]>>;
    details(path: string): Promise<FsRequestResult<FileDetails>>;
    read(path: string, encoding: BufferEncoding): Promise<FsRequestResult<string>>;
    readRaw(path: string): Promise<FsRequestResult<Buffer>>;
    write(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>>;
    writeRaw(path: string, data: Buffer): Promise<FsRequestResult<void>>;
    createDir(path: string): Promise<FsRequestResult<void>>;
    deleteFile(path: string): Promise<FsRequestResult<void>>;
    deleteDir(path: string): Promise<FsRequestResult<void>>;
    rename(oldPath: string, newPath: string, isDir: boolean): Promise<FsRequestResult<void>>;
    copyFile(src: string, dest: string): Promise<FsRequestResult<void>>;
    copyDir(src: string, dest: string): Promise<FsRequestResult<void>>;
    moveFile(src: string, dest: string): Promise<FsRequestResult<void>>;
    moveDir(src: string, dest: string): Promise<FsRequestResult<void>>;
    isFileExists(path: string): Promise<FsRequestResult<boolean>>;
    isDirExists(path: string): Promise<FsRequestResult<boolean>>;
    isFile(path: string): Promise<FsRequestResult<boolean>>;
    isDir(path: string): Promise<FsRequestResult<boolean>>;
}

interface IStorageService extends IService {
    get<T extends Record<string, any>>(namespace: string, name: string): Promise<FsRequestResult<T>>
    set<T extends Record<string, any>>(namespace: string, name: string, value: T): Promise<FsRequestResult<void>>;
    initialize<T extends Record<string, any>>(namespace: string, name: string, value: T): Promise<FsRequestResult<void>>;
}

interface ICommandService extends IService {}

interface ILoggerService extends IService {}

interface IUIService extends IService {}

interface ISettingsService extends IService {}

// Editor Services
interface IEditorService extends IService {}

interface IStoryService extends IService {}

// Asset Services
interface IAssetService extends IService {}

interface ITextureService extends IService {}

interface IAudioService extends IService {}

interface IVideoService extends IService {}

interface IFontService extends IService {}

// Runtime Services
interface IRuntimeService extends IService {}

interface IPreviewService extends IService {}

interface IBuildService extends IService {}

interface IDebugService extends IService {}

// Helper Services
interface ILocalizationService extends IService {}

interface IVersionControlService extends IService {}

// Plugin Services
interface IPluginService extends IService {}

export {
    IService,
    Service,
    WorkspaceContext,
    IFileSystemService,
    IStorageService,
    ICommandService,
    ILoggerService,
    IUIService,
    ISettingsService,
    IEditorService,
    IStoryService,
    IAssetService,
    ITextureService,
    IAudioService,
    IVideoService,
    IFontService,
    IRuntimeService,
    IPreviewService,
    IBuildService,
    IDebugService,
    ILocalizationService,
    IVersionControlService,
    IPluginService,
}
