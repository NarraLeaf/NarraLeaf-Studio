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
import type {
    UIDocument,
    UISurface,
    UISurfaceKind,
    UIHost,
    UISurfaceSettings,
    UIStageSurfaceMount,
    UILayout,
    UIElement,
} from "@shared/types/ui-editor/document";
import type {
    BindingDefinition,
    BlueprintDeclaration,
    BlueprintDeclarationValueSource,
    BlueprintDocument,
    BlueprintFrontendKind,
    BlueprintGraphIr,
} from "@shared/types/blueprint/document";
import type {
    ReadonlyBlueprintSurfaceSummary,
    ReadonlyBlueprintWidgetSummary,
} from "./ui-editor/blueprint/readonlyBlueprintSummary";
import type { SubtreeDuplicateRemapPlan } from "./ui-editor/blueprint/blueprintCopyRemap";
import type { UIGraph, UIGraphDocument } from "@shared/types/ui-editor/graph";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { ReactElement } from "react";
import type { ElementRendererDefinition } from "../../ui-editor/runtime/ElementRendererRegistry";
import type { RenderSurfaceOptions } from "../../ui-editor/runtime/types";
import type { ViewportTransform } from "../../ui-editor/geometry/types";
import type { UITool } from "../../ui-editor/editor/types";
import type { SelectionState } from "./ui/UIStore";
import type { DevModeEntry, DevModeStatus } from "@shared/types/devMode";

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
    PanelState = "panelState",
    UIDocument = "uiDocument",
    RuntimeBridge = "runtimeBridge",
    UIEditorState = "uiEditorState",
    UIGraph = "uiGraph",
    LocalBlueprint = "localBlueprint",
    UIBlueprintLifecycle = "uiBlueprintLifecycle",
    DevMode = "devMode",
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

interface IPanelStateService extends IService {
    getPanelState<T extends Record<string, any>>(panelId: string): T | undefined;
    setPanelState<T extends Record<string, any>>(panelId: string, partial: Partial<T>): void;
    replacePanelState<T extends Record<string, any>>(panelId: string, next: T): void;
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

interface IUIDocumentService extends IService {
    load(): Promise<UIDocument>;
    save(document: UIDocument): Promise<void>;
    getDocument(): UIDocument;
    onDocumentChanged(handler: (doc: UIDocument) => void): () => void;
    onDirtyChanged(handler: (dirty: boolean) => void): () => void;
    isDirty(): boolean;
    getRevision(): number;
    /** Blueprint M2: invoked after each in-memory uidoc mutation (before auto-save). */
    setAfterMutateHook(hook: (() => void) | null): void;
    updateElementLayout(elementId: string, layoutPatch: Partial<UILayout>): void;
    updateElementLayouts(layoutPatches: Record<string, Partial<UILayout>>): void;
    updateElementProps(elementId: string, propsPatch: Record<string, unknown>): void;
    reorderChildren(parentId: string, orderedChildIds: string[]): void;
    createSurface(input: {
        kind: UISurfaceKind;
        name: string;
        host: UIHost;
        stageMount?: UIStageSurfaceMount;
        settings?: UISurfaceSettings;
    }): UISurface;
    deleteSurface(surfaceId: string): void;
    updateSurface(surfaceId: string, updater: (surface: UISurface) => void): void;
    createElement(parentId: string, type: string, layoutPatch?: Partial<UILayout>): UIElement;
    deleteElements(elementIds: string[]): void;
    /**
     * Persist UIBehaviorBinding.blueprintEvent and ensure inline event graph under Blueprint.program.graphs.events.
     */
    setElementBlueprintEvent(
        elementId: string,
        eventName: string,
        ref: { blueprintId: string; eventId: string },
    ): void;
    /** Remove behavior binding and drop the referenced event graph slot from the blueprint document. */
    clearElementBlueprintEvent(elementId: string, eventName: string): void;
}

interface IUIGraphService extends IService {
    load(): Promise<UIGraphDocument>;
    save(document: UIGraphDocument): Promise<void>;
    getDocument(): UIGraphDocument;
    onGraphsChanged(handler: (doc: UIGraphDocument) => void): () => void;
    onDirtyChanged(handler: (dirty: boolean) => void): () => void;
    isDirty(): boolean;
    getRevision(): number;
    applyGraphMutation(mutator: (document: UIGraphDocument) => void): void;
    createGraph(input: {
        name?: string;
        nodes?: Record<string, UIGraph["nodes"][string]>;
        entries?: UIGraph["entries"];
        edges?: UIGraph["edges"];
        variables?: UIGraph["variables"];
        meta?: UIGraph["meta"];
    }): UIGraph;
    updateGraph(graphId: string, updater: (graph: UIGraph) => void): void;
    deleteGraph(graphId: string): void;
}

interface ILocalBlueprintService extends IService {
    getBlueprintDocument(): BlueprintDocument;
    applyBlueprintMutation(mutator: (bp: BlueprintDocument, doc: UIGraphDocument) => void): void;
    ensureSurfaceMain(surfaceId: string, displayName?: string): string;
    removeSurfaceAndWidgetOwners(surfaceId: string): void;
    ensureWidgetMain(surfaceId: string, elementId: string, displayName?: string): string;
    removeWidgetMain(surfaceId: string, elementId: string): void;
    getWidgetMainBlueprintId(surfaceId: string, elementId: string): string | undefined;
    getSurfaceMainBlueprintId(surfaceId: string): string | undefined;
    getReadonlySurfaceMainSummary(surfaceId: string): ReadonlyBlueprintSurfaceSummary;
    createDeclaration(
        blueprintId: string,
        input: { name: string; kind?: BlueprintDeclaration["kind"]; valueSource?: BlueprintDeclarationValueSource },
    ): BlueprintDeclaration;
    setDeclarationValueSource(
        blueprintId: string,
        declarationId: string,
        valueSource: BlueprintDeclarationValueSource | undefined,
    ): void;
    renameDeclaration(blueprintId: string, declarationId: string, name: string): void;
    deleteDeclaration(blueprintId: string, declarationId: string): void;
    setWidgetPropBinding(params: {
        blueprintId: string;
        surfaceId: string;
        elementId: string;
        propPath: string;
        declarationId: string;
        fallback?: BindingDefinition["fallback"];
    }): string;
    clearWidgetPropBinding(blueprintId: string, surfaceId: string, elementId: string, propPath: string): void;
    findWidgetPropBinding(
        blueprintId: string,
        surfaceId: string,
        elementId: string,
        propPath: string,
    ): BindingDefinition | undefined;
    listDeclarations(blueprintId: string): BlueprintDeclaration[];
    ensureEventGraph(blueprintId: string, eventId: string, displayName?: string): void;
    removeEventGraph(blueprintId: string, eventId: string): void;
    listEventGraphIds(blueprintId: string): string[];
    ensureFunctionGraph(blueprintId: string, functionId: string, displayName?: string): void;
    removeFunctionGraph(blueprintId: string, functionId: string): void;
    listFunctionGraphIds(blueprintId: string): string[];
    updateEventGraphIr(blueprintId: string, eventId: string, updater: (ir: BlueprintGraphIr) => void): void;
    updateFunctionGraphIr(blueprintId: string, functionId: string, updater: (ir: BlueprintGraphIr) => void): void;
    updateScriptModuleSource(blueprintId: string, code: string): void;
    getReadonlyWidgetMainSummary(surfaceId: string, element: UIElement): ReadonlyBlueprintWidgetSummary;
    planSubtreeDuplicateBlueprintRemap(input: {
        surfaceId: string;
        oldElementIds: string[];
        generateId: () => string;
    }): SubtreeDuplicateRemapPlan;
    /** Private owner slot keys: globalMain, surfaceMain:<id>, widgetMain:<surfaceId>:<elementId>. */
    listPrivateBlueprintIdsForOwnerKey(ownerKey: string): string[];
    setActivePrivateBlueprintForOwnerKey(ownerKey: string, blueprintId: string): void;
    /** Adds a new blueprint revision for the owner; becomes active; prior blueprints stay in the record. */
    createSiblingPrivateBlueprintForOwnerKey(ownerKey: string, frontend: BlueprintFrontendKind): string;
}

interface IUIBlueprintLifecycleCoordinator extends IService {
    /** Reconcile instance main blueprints with current UIDocument (surfaces + logic-capable widgets). */
    syncFromUidoc(): void;
}

interface IUIRuntimeBridgeService extends IService {
    renderSurface(options: RenderSurfaceOptions): ReactElement | null;
    registerElementRenderer(definition: ElementRendererDefinition): void;
}

export type InteractionOverride =
    | {
          kind: "imageCrop";
          surfaceId: string;
          elementId: string;
          source: string;
      }
    | {
          kind: "textEdit";
          surfaceId: string;
          elementId: string;
      };

interface UIEditorStateEvents {
    toolChanged: UITool;
    viewportChanged: ViewportTransform;
    selectionChanged: SelectionState;
    interactionOverrideChanged: InteractionOverride | null;
}

interface IUIEditorStateService extends IService {
    getTool(): UITool;
    setTool(tool: UITool): void;
    getViewportTransform(): ViewportTransform;
    updateViewport(transform: Partial<ViewportTransform>): ViewportTransform;
    resetViewport(): ViewportTransform;
    getSelection(): SelectionState;
    setSelection(selection: SelectionState): void;
    setUIElementSelection(selection: UIElementSelection): void;
    getDocument(): UIDocument;
    getSurface(surfaceId: string): UISurface | undefined;
    on<K extends keyof UIEditorStateEvents>(event: K, handler: (data: UIEditorStateEvents[K]) => void): () => void;
}

interface IDevModeService extends IService {
    getStatus(): DevModeStatus;
    refreshStatus(): Promise<DevModeStatus>;
    launch(entry: DevModeEntry, projectPath?: string): Promise<DevModeStatus>;
    stop(): Promise<DevModeStatus>;
    reload(): Promise<DevModeStatus>;
    onStatusChanged(handler: (status: DevModeStatus) => void): () => void;
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
    fetch<T extends AssetType>(asset: Asset<T, AssetSource>): Promise<RequestStatus<AssetData<T>>>;
    exists<T extends AssetType>(asset: Asset<T, AssetSource>): boolean;
    importLocalAssets<T extends AssetType>(type: T): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>>;
    importRemoteAsset<T extends AssetType>(type: T, url: string): Promise<RequestStatus<Asset<T, AssetSource.Remote>>>;
    clearRemoteCache(assetId?: string): Promise<void>;
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
    IService, IServiceAssetsService, IPanelStateService, ISettingsService, IStorageService, IStoryService,
    ITextureService, IUIService, IUuidService, IVersionControlService, IVideoService,
    ICharacterService, IUIDocumentService, IUIGraphService, ILocalBlueprintService, IUIBlueprintLifecycleCoordinator,
    IUIRuntimeBridgeService, IUIEditorStateService, IDevModeService, UIEditorStateEvents,
    Services, WorkspaceContext
};

