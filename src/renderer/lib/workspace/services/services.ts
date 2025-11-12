import { FsRequestResult } from "@shared/types/os";
import { FileDetails, FileStat } from "@shared/utils/fs";
import { Porject, ProjectConfig } from "../project/project";
import { Asset, AssetsMap, AssetSource } from "./assets/types";
import { ServiceRegistry } from "./serviceRegistry";
import { AssetData, AssetType } from "./assets/assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";

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
    UI = "ui",
    ProjectSettings = "projectSettings",
    // Storage = "storage",
    // Command = "command",
    // Logger = "logger",
    // Settings = "settings",
    // Editor = "editor",
    // Story = "story",
    Assets = "assets",
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

// Core Services
interface IProjectService extends IService {
    getProjectConfig(): ProjectConfig;
}

interface IFileSystemService extends IService {
    stat(path: string): Promise<FsRequestResult<FileStat>>;
    list(path: string): Promise<FsRequestResult<FileStat[]>>;
    details(path: string): Promise<FsRequestResult<FileDetails>>;
    read(path: string, encoding: BufferEncoding): Promise<FsRequestResult<string>>;
    readRaw(path: string): Promise<FsRequestResult<Uint8Array>>;
    write(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>>;
    writeRaw(path: string, data: Uint8Array): Promise<FsRequestResult<void>>;
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

interface IProjectSettingsService extends IService {
    get<T = any>(key: string, defaultValue?: T): Promise<T | undefined>;
    set<T = any>(key: string, value: T): Promise<void>;
    getAll(): Record<string, any>;
    clear(): Promise<void>;
    has(key: string): boolean;
    getSync<T = any>(key: string, defaultValue?: T): T | undefined;
}

interface IStorageService extends IService {
    get<T extends Record<string, any>>(namespace: string, name: string): Promise<FsRequestResult<T>>
    set<T extends Record<string, any>>(namespace: string, name: string, value: T): Promise<FsRequestResult<void>>;
}

interface ICommandService extends IService { }

interface ILoggerService extends IService { }

interface IUIService extends IService {
    showConfirm(message: string, detail?: string): Promise<boolean>;
    showAlert(message: string, detail?: string): Promise<void>;
    showNotification(message: string, type?: "info" | "success" | "warning" | "error"): void;
    showError(error: Error | string): void;
}

interface ISettingsService extends IService { }

// Editor Services
interface IEditorService extends IService { }

interface IStoryService extends IService { }

// Asset Services
interface IAssetService extends IService {
    getAssets(): AssetsMap;
    getMetadata<T extends AssetType>(type: T, name: string): Asset<T>;
    checkIntegrity(): Promise<FsRequestResult<void, false>[]>;

    list<T extends AssetType>(type: T): string[];
    fetch<T extends AssetType>(asset: Asset<T>): Promise<RequestStatus<AssetData<T>>>;
    exists<T extends AssetType>(asset: Asset<T>): boolean;
    importLocalAssets<T extends AssetType>(type: T): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>>;
}

interface ITextureService extends IService { }

interface IAudioService extends IService { }

interface IVideoService extends IService { }

interface IFontService extends IService { }

// Runtime Services
interface IRuntimeService extends IService { }

interface IPreviewService extends IService { }

interface IBuildService extends IService { }

interface IDebugService extends IService { }

// Helper Services
interface ILocalizationService extends IService { }

interface IVersionControlService extends IService { }

// Plugin Services
interface IPluginService extends IService { }

export {
    IAssetService, IAudioService, IBuildService, ICommandService, IDebugService, IEditorService, IFileSystemService, IFontService, ILocalizationService, ILoggerService, IPluginService, IPreviewService, IProjectService, IProjectSettingsService, IRuntimeService, IService, ISettingsService, IStorageService, IStoryService, ITextureService, IUIService, IVersionControlService, IVideoService, Services, WorkspaceContext
};

