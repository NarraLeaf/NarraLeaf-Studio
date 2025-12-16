import { FsRequestResult } from "@shared/types/os";
import { FileDetails, FileStat } from "@shared/utils/fs";
import { Porject, ProjectConfig } from "../project/project";
import { Asset, AssetsMap, AssetSource } from "./assets/types";
import { ServiceRegistry } from "./serviceRegistry";
import { AssetData, AssetType } from "./assets/assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { Character } from "./character/Character";
import { CharacterGroup } from "./character/types";
import { RuntimeSettingSchema, RuntimeSettingType, TypeofSettingSchema } from "./settings/types";

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
    Uuid = "uuid",
    FileSystem = "fileSystem",
    UI = "ui",
    ProjectSettings = "projectSettings",
    ServiceAssets = "serviceAssets",
    // Storage = "storage",
    // Command = "command",
    // Logger = "logger",
    Settings = "settings",
    // Editor = "editor",
    // Story = "story",
    Character = "character",
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

interface IUuidService extends IService {
    generate(compact?: boolean): string;
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

interface ISettingsService extends IService {
    getCategories(): string[];
    getSettings(category: string): RuntimeSettingSchema<RuntimeSettingType>[];
    get(name: string): RuntimeSettingSchema<RuntimeSettingType> | undefined;
    getValue<T extends RuntimeSettingType>(name: string): TypeofSettingSchema<T> | undefined;
    setValue<T extends RuntimeSettingType>(name: string, value: TypeofSettingSchema<T>): Promise<void>;
}

// Editor Services
interface IEditorService extends IService { }

interface IStoryService extends IService { }

interface ICharacterService extends IService {
    getCharacter(id: string): Character | undefined;
    listCharacter(): Character[];
    createCharacter(name: string): Character;
    renameCharacter(id: string, name: string): boolean;
    deleteCharacter(id: string): boolean;
    listGroups(): CharacterGroup[];
    getGroup(id: string): CharacterGroup | undefined;
    createGroup(name: string): CharacterGroup;
    renameGroup(id: string, name: string): boolean;
    deleteGroup(id: string): boolean;
    assignCharacterToGroup(characterId: string, groupId?: string): boolean;
    listCharactersByGroup(groupId?: string): Character[];
}

// Asset Services
interface IAssetService extends IService {
    getAssets(): AssetsMap;

    list<T extends AssetType>(type: T): string[];
    fetch<T extends AssetType>(asset: Asset<T>): Promise<RequestStatus<AssetData<T>>>;
    exists<T extends AssetType>(asset: Asset<T>): boolean;
    importLocalAssets<T extends AssetType>(type: T): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>>;
}

interface IServiceAssetsService extends IService {
    writeStore<T extends Record<string, any>>(namespace: string, data: T): Promise<FsRequestResult<{ path: string }>>;
    readStore<T extends Record<string, any>>(namespace: string): Promise<FsRequestResult<T>>;
    writeFile(data: string | Buffer): Promise<FsRequestResult<string>>;
    readFile(fileId: string, encoding?: BufferEncoding): Promise<FsRequestResult<string>>;
    readRaw(fileId: string): Promise<FsRequestResult<Uint8Array>>;
    deleteFile(fileId: string): Promise<FsRequestResult<void>>;
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
    IAssetService, IAudioService, IBuildService, ICommandService, IDebugService,
    IEditorService, IFileSystemService, IFontService, ILocalizationService, ILoggerService,
    IPluginService, IPreviewService, IProjectService, IProjectSettingsService, IRuntimeService,
    IService, IServiceAssetsService, ISettingsService, IStorageService, IStoryService,
    ITextureService, IUIService, IUuidService, IVersionControlService, IVideoService,
    ICharacterService, Services, WorkspaceContext
};

