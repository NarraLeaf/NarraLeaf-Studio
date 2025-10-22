import { FsRequestResult } from "@shared/types/os";
import { FileDetails, FileStat } from "@shared/utils/fs";
import { Porject, ProjectConfig } from "../project/project";
import { ServiceRegistry } from "./serviceRegistry";

interface WorkspaceContext {
    project: Porject;
    services: ServiceRegistry;
}

interface IService {
    activate(ctx: WorkspaceContext): Promise<void> | void;
    dispose(ctx: WorkspaceContext): Promise<void> | void;
}

enum Services {
    Project = "project",
    FileSystem = "fileSystem",
    // Storage = "storage",
    // Command = "command",
    // Logger = "logger",
    // UI = "ui",
    // Settings = "settings",
    // Editor = "editor",
    // Story = "story",
    // Asset = "asset",
    // Texture = "texture",
    // Audio = "audio",
    // Video = "video",
    // Font = "font",
    // Runtime = "runtime",
    // Preview = "preview",
    // Build = "build",
    // Debug = "debug",
    // Localization = "localization",
    // VersionControl = "versionControl",
    // Plugin = "plugin",
}

abstract class Service implements IService {
    private ctx: WorkspaceContext | null = null;
    private _initialized = false;

    public static async initializeAll(ctx: WorkspaceContext): Promise<void> {
        const pending = new Set<Service>();

        const init = async (service: Service): Promise<void> => {
            if ((service as any)._initialized) return;
            if (pending.has(service)) {
                const cycle = [...pending, service].map(s => s.constructor.name).join(" -> ");
                throw new Error(`Circular dependency detected: ${cycle}`);
            }
            pending.add(service);
            const depend = async (deps: Service[]): Promise<void> => {
                for (const dep of deps) {
                    await init(dep);
                }
            };
            await service.initialize(ctx, depend);
            pending.delete(service);
        };

        const all = ctx.services.getAll();
        for (let i = all.length - 1; i >= 0; i--) {
            await init(all[i]);
        }
    }

    protected abstract init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> | void;

    public setContext(ctx: WorkspaceContext): void {
        this.ctx = ctx;
    }

    public getContext(): WorkspaceContext | null {
        if (!this.ctx) {
            throw new Error("Trying to access context of a service before initialization");
        }
        return this.ctx;
    }

    public async initialize(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        this.setContext(ctx);
        await this.init(ctx, depend);
        this._initialized = true;
    }

    public activate(_ctx: WorkspaceContext): Promise<void> | void {}

    public dispose(_ctx: WorkspaceContext): Promise<void> | void {}
}

// Core Services
interface IProjectService extends IService {
    getProjectConfig(): ProjectConfig;
}

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

    readJSON<T>(path: string): Promise<FsRequestResult<T>>;
}

interface IStorageService extends IService {
    get<T extends Record<string, any>>(namespace: string, name: string): Promise<FsRequestResult<T>>
    set<T extends Record<string, any>>(namespace: string, name: string, value: T): Promise<FsRequestResult<void>>;
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
    IAssetService, IAudioService, IBuildService, ICommandService, IDebugService, IEditorService, IFileSystemService, IFontService, ILocalizationService, ILoggerService, IPluginService, IPreviewService, IProjectService, IRuntimeService, IService, ISettingsService, IStorageService, IStoryService, ITextureService, IUIService, IVersionControlService, IVideoService, Service,
    WorkspaceContext, Services,
};

