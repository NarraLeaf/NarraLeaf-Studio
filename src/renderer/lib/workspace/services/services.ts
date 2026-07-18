import { FsRequestResult } from "@shared/types/os";
import { FileDetails, FileStat } from "@shared/utils/fs";
import { Porject, ProjectConfig, ProjectIconConfig, ProjectIconPlatform, ProjectMetadata } from "../project/project";
import type { MobileConfiguration, NetworkConfiguration, SecurityConfiguration } from "../project/configuration";
import type {
    LocalizationConfiguration,
    LocalizationDocument,
    LocalizationLocaleEntry,
} from "@shared/types/localization";
import type { ProjectDependencyResolution, ProjectDependencyTable } from "@shared/types/pluginDependencies";
import { Asset, AssetsMap, AssetSource } from "./assets/types";
import { ServiceRegistry } from "./serviceRegistry";
import { AssetData, AssetType } from "./assets/assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { Character } from "./character/Character";
import { CharacterGroup } from "./character/types";
import type {
    UIDocument,
    UISurface,
    UISurfaceKind,
    UIHost,
    UISurfaceDesignSize,
    UISurfaceSettings,
    UIStageSurfaceMount,
    UILayout,
    UIElement,
    UIComponentDefinition,
    UIElementValueBindingValueType,
} from "@shared/types/ui-editor/document";
import type {
    BindingDefinition,
    BlueprintDocument,
    BlueprintField,
    BlueprintFieldValueSource,
    BlueprintFrontendKind,
    BlueprintGraphIr,
    BlueprintPrivateOwnerRecord,
    Blueprint,
} from "@shared/types/blueprint/document";
import type {
    ReadonlyBlueprintSurfaceSummary,
    ReadonlyBlueprintWidgetSummary,
} from "./ui-editor/blueprint/readonlyBlueprintSummary";
import type { SubtreeDuplicateRemapPlan } from "./ui-editor/blueprint/blueprintCopyRemap";
import type { MoveUiElementsResult } from "./ui-editor/uiDocumentTreeMove";
import type { UIGraph, UIGraphDocument } from "@shared/types/ui-editor/graph";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { ReactElement } from "react";
import type { ElementRendererDefinition } from "../../ui-editor/runtime/ElementRendererRegistry";
import type { RenderComponentOptions, RenderDocumentSurfaceOptions, RenderSurfaceOptions } from "../../ui-editor/runtime/types";
import type { ViewportTransform } from "../../ui-editor/geometry/types";
import type { UITool } from "../../ui-editor/editor/types";
import type { ActiveSnapGuides, SmartSnapDetailSettings } from "../../ui-editor/snapping/types";
import type { SelectionState } from "./ui/UIStore";
import type { DevModeEntry, DevModeStatus } from "@shared/types/devMode";
import type { GameRuntimeLaunchEntry, PreviewStatus } from "@shared/types/gameRuntime";
import type { GameBuildRequest, GameBuildStateSnapshot, GameBuildStatus } from "@shared/types/gameBuild";
import type {
    ConsoleAppendInput,
    ConsoleChannelDefinition,
    ConsoleChannelId,
    ConsoleEntry,
    ConsoleLogLevel,
    ConsoleProgress,
    ConsoleProgressInput,
} from "./core/ConsoleService";
import type {
    StoryAnimationAsset,
    StoryAnimationAssetId,
    StoryAnimationIndex,
    StoryAnimationIndexEntry,
    StoryAnimationSequence,
    StoryAnimationTimeline,
    StoryBlock,
    StoryBlockId,
    StoryChapter,
    StoryDocument,
    StoryId,
    StoryLibraryEntry,
    StoryLibraryIndex,
    StoryScene,
    StorySceneId,
    StorySceneUpdate,
} from "@shared/types/story";
import type {
    BlueprintNodeDef,
    BlueprintNodeEditorCatalogEntry,
    BlueprintInspectorParamSelectOption,
    BlueprintPaletteContext,
} from "../../ui-editor/blueprint-nodes/types";

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
    GlobalSettings = "globalSettings",
    ServiceAssets = "serviceAssets",
    PanelState = "panelState",
    RecentColors = "recentColors",
    UIDocument = "uiDocument",
    RuntimeBridge = "runtimeBridge",
    UIEditorState = "uiEditorState",
    UIEditorHistory = "uiEditorHistory",
    UIGraph = "uiGraph",
    LocalBlueprint = "localBlueprint",
    UIBlueprintLifecycle = "uiBlueprintLifecycle",
    DevMode = "devMode",
    Preview = "preview",
    Build = "build",
    Console = "console",
    /** Ref-counted FontFace + blob URLs for UI editor widgets */
    UIEditorFontFace = "uiEditorFontFace",
    /** Blueprint node definitions (built-ins + plugin extensions); editor + runtime registry */
    BlueprintNodeCatalog = "blueprintNodeCatalog",
    // Storage = "storage",
    /** Command palette registry + aggregator (actions, menus, keybindings) */
    Command = "command",
    /** Global project search index (story text, variable names, UI text keys, blueprint node titles) */
    Search = "search",
    // Logger = "logger",
    // Editor = "editor",
    Story = "story",
    Character = "character",
    Assets = "assets",
    /** Per-project plugin dependency table: scan, persist, and resolve compatibility */
    ProjectDependency = "projectDependency",
    /** Accumulated authoring activity (writing curve, active time, build history) */
    ProjectStats = "projectStats",
    // Texture = "texture",
    // Audio = "audio",
    // Video = "video",
    // Font = "font",
    // Runtime = "runtime",
    // Build = "build",
    // Debug = "debug",
    Localization = "localization",
    // VersionControl = "versionControl",
    // Plugin = "plugin",
}

// Core Services
interface IProjectService extends IService {
    getProjectConfig(): ProjectConfig;
    updateProjectConfig(updater: (config: ProjectConfig) => ProjectConfig): Promise<ProjectConfig>;
    updateProjectName(name: string): Promise<ProjectConfig>;
    updateProjectMetadata(patch: Partial<ProjectMetadata>): Promise<ProjectConfig>;
    getNetworkConfiguration(): NetworkConfiguration;
    updateNetworkConfiguration(patch: Partial<NetworkConfiguration>): Promise<ProjectConfig>;
    getSecurityConfiguration(): SecurityConfiguration;
    updateSecurityConfiguration(patch: Partial<SecurityConfiguration>): Promise<ProjectConfig>;
    updateMobileConfiguration(patch: Partial<MobileConfiguration>): Promise<ProjectConfig>;
    importProjectIcon(platform: ProjectIconPlatform): Promise<{
        platform: ProjectIconPlatform;
        sourcePath: string;
        projectPath: string;
        relativePath: string;
        icon: ProjectIconConfig;
        bytes: Uint8Array;
    } | null>;
    readProjectIcon(platform: ProjectIconPlatform): Promise<Uint8Array | null>;
    getDependencyTable(): ProjectDependencyTable | undefined;
    setDependencyTable(table: ProjectDependencyTable | undefined): Promise<ProjectConfig>;
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
    ensureRegularFile(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>>;
    writeFileNoFollow(path: string, data: string, encoding: BufferEncoding): Promise<FsRequestResult<void>>;
    recoverCorruptedJsonFile(path: string, replacement: string, encoding: BufferEncoding): Promise<FsRequestResult<void>>;
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

interface IGlobalSettingsService extends IService {
    get<T = any>(key: string, defaultValue?: T): Promise<T | undefined>;
    set<T = any>(key: string, value: T): Promise<void>;
    setBatch(settings: Record<string, any>): Promise<void>;
    getAll(): Record<string, any>;
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

/**
 * Command palette registry + aggregator. The concrete {@link CommandService} exposes
 * `register`/`unregister`/`getRegistered` (mirroring the keybinding service) and `collect`, which
 * converges toolbar actions, menu groups, and described keybindings into one runnable list.
 */
interface ICommandService extends IService { }

interface ILoggerService extends IService { }

interface IUIService extends IService {
    showConfirm(message: string, detail?: string): Promise<boolean>;
    showAlert(message: string, detail?: string): Promise<void>;
    showNotification(message: string, type?: "info" | "success" | "warning" | "error"): void;
    showError(error: Error | string): void;
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
    restoreDocumentFromHistory(document: UIDocument, options?: { skipAfterMutateHook?: boolean }): void;
    runSurfaceHistoryTransaction(surfaceId: string, action: () => void): void;
    updateElementLayout(elementId: string, layoutPatch: Partial<UILayout>, options?: { skipHistory?: boolean }): void;
    updateElementLayouts(layoutPatches: Record<string, Partial<UILayout>>): void;
    updateElementProps(elementId: string, propsPatch: Record<string, unknown>): void;
    ensureElementBlueprintValueBinding(
        elementId: string,
        propPath: string,
        input: { valueType: UIElementValueBindingValueType; displayName?: string; literalValue?: unknown },
    ): { blueprintId: string };
    clearElementBlueprintValueBinding(elementId: string, propPath: string): void;
    updateElementExtra(elementId: string, extraPatch: Record<string, unknown>): void;
    reorderChildren(parentId: string, orderedChildIds: string[]): void;
    createSurface(input: {
        kind: UISurfaceKind;
        name: string;
        host: UIHost;
        designSize?: UISurfaceDesignSize;
        stageMount?: UIStageSurfaceMount;
        settings?: UISurfaceSettings;
    }): UISurface;
    deleteSurface(surfaceId: string): void;
    renameSurface(surfaceId: string, name: string): void;
    updateSurface(surfaceId: string, updater: (surface: UISurface) => void): void;
    duplicateSurface(surfaceId: string, name?: string): UISurface | null;
    getComponent(componentId: string): UIComponentDefinition | undefined;
    getComponentUsageCount(componentId: string): number;
    createEmptyComponent(name?: string): UIComponentDefinition;
    createComponentFromElements(surfaceId: string, elementIds: string[], name?: string): UIComponentDefinition | null;
    renameComponent(componentId: string, name: string): void;
    deleteComponents(componentIds: string[]): void;
    duplicateComponent(componentId: string): UIComponentDefinition | null;
    updateComponentElementLayout(componentId: string, elementId: string, layoutPatch: Partial<UILayout>): void;
    updateComponentElementProps(componentId: string, elementId: string, propsPatch: Record<string, unknown>): void;
    updateComponentElementExtra(componentId: string, elementId: string, extraPatch: Record<string, unknown>): void;
    setComponentElementBlueprintEvent(
        componentId: string,
        elementId: string,
        eventName: string,
        ref: { blueprintId: string; eventId: string },
    ): void;
    clearComponentElementBlueprintEvent(componentId: string, elementId: string, eventName: string): void;
    stripComponentBlueprintLayerBindings(componentId: string, blueprintId: string, layerEventId: string): void;
    renameComponentElement(componentId: string, elementId: string, name: string): void;
    reorderComponentChildren(componentId: string, parentId: string, orderedChildIds: string[]): void;
    deleteComponentElements(componentId: string, elementIds: string[]): void;
    moveComponentElements(
        componentId: string,
        elementIds: string[],
        targetParentId: string,
        beforeChildId: string | null,
    ): MoveUiElementsResult;
    createComponentElement(
        componentId: string,
        parentId: string,
        type: string,
        layoutPatch?: Partial<UILayout>,
    ): UIElement | null;
    pasteComponentClipboardPayload(
        componentId: string,
        targetParentId: string,
        beforeChildId: string | null,
        payload: import("@/lib/ui-editor/commands/uiEditorClipboard").UIEditorClipboardPayload,
    ):
        | { ok: true; newRootIds: string[] }
        | { ok: false; reason: "invalid_clipboard" | "invalid_target" };
    createComponentInstance(parentId: string, componentId: string, layoutPatch?: Partial<UILayout>): UIElement;
    unlinkComponentInstance(elementId: string): string[];
    createElement(parentId: string, type: string, layoutPatch?: Partial<UILayout>): UIElement;
    deleteElements(elementIds: string[]): void;
    /**
     * Reparent one or more elements within the editable tree of a surface (uses effective root for linked stage surfaces).
     * Inserts `elementIds` (normalized) before `beforeChildId` under `targetParentId`, or appends when `beforeChildId` is null.
     */
    moveElementsInSurface(
        surfaceId: string,
        elementIds: string[],
        targetParentId: string,
        beforeChildId: string | null,
    ): MoveUiElementsResult;
    /** Paste a snapshot from `buildUiEditorClipboardPayload` under `targetParentId`. */
    pasteClipboardPayload(
        surfaceId: string,
        targetParentId: string,
        beforeChildId: string | null,
        payload: import("@/lib/ui-editor/commands/uiEditorClipboard").UIEditorClipboardPayload,
    ):
        | { ok: true; newRootIds: string[] }
        | { ok: false; reason: "invalid_clipboard" | "invalid_target" };
    renameElement(elementId: string, name: string): void;
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
    /**
     * Set UI blueprintEvent hooks to noop when they target the given blueprint layer (event graph slot).
     * Does not remove the graph from the blueprint document — call LocalBlueprintService.removeEventGraph after.
     */
    stripBlueprintLayerBindings(surfaceId: string, blueprintId: string, layerEventId: string): void;
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
    getBlueprintHistoryLimit(): number;
    setBlueprintHistoryLimit(limit: number): void;
    captureBlueprintHistorySnapshot(blueprintId: string, ownerKey?: string): {
        blueprintId: string;
        ownerKey: string | null;
        ownerRecord: BlueprintPrivateOwnerRecord | null;
        blueprint: Blueprint | null;
        uiBehavior: unknown;
    };
    runBlueprintHistoryTransaction<T>(
        blueprintId: string,
        action: () => T,
        options?: { ownerKey?: string; mergeKey?: string; mergeWindowMs?: number },
    ): T;
    canUndoBlueprint(blueprintId: string): boolean;
    canRedoBlueprint(blueprintId: string): boolean;
    undoBlueprint(blueprintId: string): boolean;
    redoBlueprint(blueprintId: string): boolean;
    clearBlueprintHistory(blueprintId?: string): void;
    onBlueprintHistoryChanged(handler: (event: { blueprintId: string; ownerKey: string | null }) => void): () => void;
    ensureSurfaceMain(surfaceId: string, displayName?: string): string;
    removeSurfaceAndWidgetOwners(surfaceId: string): void;
    ensureWidgetMain(surfaceId: string, elementId: string, displayName?: string, widgetType?: string): string;
    removeWidgetMain(surfaceId: string, elementId: string): void;
    getWidgetMainBlueprintId(surfaceId: string, elementId: string): string | undefined;
    ensureComponentWidgetMain(componentId: string, elementId: string, displayName?: string, widgetType?: string): string;
    removeComponentWidgetMain(componentId: string, elementId: string): void;
    getComponentWidgetMainBlueprintId(componentId: string, elementId: string): string | undefined;
    ensureWidgetValueBlueprint(input: {
        surfaceId: string;
        elementId: string;
        propPath: string;
        valueType: UIElementValueBindingValueType;
        displayName?: string;
        literalValue?: unknown;
    }): string;
    removeWidgetValueBlueprint(surfaceId: string, elementId: string, propPath: string): void;
    getWidgetValueBlueprintId(surfaceId: string, elementId: string, propPath: string): string | undefined;
    getSurfaceMainBlueprintId(surfaceId: string): string | undefined;
    getReadonlySurfaceMainSummary(surfaceId: string): ReadonlyBlueprintSurfaceSummary;
    getReadonlyComponentWidgetMainSummary(componentId: string, element: UIElement): ReadonlyBlueprintWidgetSummary;
    createField(
        blueprintId: string,
        input: { name: string; kind?: BlueprintField["kind"]; valueSource?: BlueprintFieldValueSource },
    ): BlueprintField;
    setFieldValueSource(
        blueprintId: string,
        fieldId: string,
        valueSource: BlueprintFieldValueSource | undefined,
    ): void;
    renameField(blueprintId: string, fieldId: string, name: string): void;
    deleteField(blueprintId: string, fieldId: string): void;
    setWidgetPropBinding(params: {
        blueprintId: string;
        surfaceId: string;
        elementId: string;
        propPath: string;
        fieldId: string;
        fallback?: BindingDefinition["fallback"];
    }): string;
    clearWidgetPropBinding(blueprintId: string, surfaceId: string, elementId: string, propPath: string): void;
    findWidgetPropBinding(
        blueprintId: string,
        surfaceId: string,
        elementId: string,
        propPath: string,
    ): BindingDefinition | undefined;
    listFields(blueprintId: string): BlueprintField[];
    createBlueprintVariable(
        blueprintId: string,
        input?: {
            name?: string;
            valueType?: string;
            defaultValue?: import("@shared/types/blueprint/document").LiteralValue;
        },
    ): import("@shared/types/blueprint/document").BlueprintVariable;
    createPersistentVariable(
        historyBlueprintId: string,
        input?: {
            name?: string;
            valueType?: string;
            defaultValue?: import("@shared/types/blueprint/document").LiteralValue;
        },
    ): import("@shared/types/blueprint/document").BlueprintPersistentVariable;
    renamePersistentVariable(historyBlueprintId: string, variableId: string, name: string): void;
    setPersistentVariableDefault(
        historyBlueprintId: string,
        variableId: string,
        defaultValue: import("@shared/types/blueprint/document").LiteralValue | undefined,
    ): void;
    deletePersistentVariable(historyBlueprintId: string, variableId: string): void;
    renameBlueprintVariable(blueprintId: string, variableId: string, name: string): void;
    setBlueprintVariableDefault(
        blueprintId: string,
        variableId: string,
        defaultValue: import("@shared/types/blueprint/document").LiteralValue | undefined,
    ): void;
    deleteBlueprintVariable(blueprintId: string, variableId: string): void;
    ensureEventGraph(blueprintId: string, eventId: string, displayName?: string): void;
    adoptLegacyEventGraphToSlot(blueprintId: string, slotId: string, legacyEventId: string, displayName?: string): void;
    renameEventGraph(blueprintId: string, eventId: string, displayName: string): void;
    removeEventGraph(blueprintId: string, eventId: string): void;
    listEventGraphIds(blueprintId: string): string[];
    ensureFunctionGraph(blueprintId: string, functionId: string, displayName?: string): void;
    removeFunctionGraph(blueprintId: string, functionId: string): void;
    listFunctionGraphIds(blueprintId: string): string[];
    updateEventGraphIr(
        blueprintId: string,
        eventId: string,
        updater: (ir: BlueprintGraphIr) => void,
        options?: { mergeKey?: string; mergeWindowMs?: number },
    ): void;
    updateFunctionGraphIr(
        blueprintId: string,
        functionId: string,
        updater: (ir: BlueprintGraphIr) => void,
        options?: { mergeKey?: string; mergeWindowMs?: number },
    ): void;
    updateScriptModuleSource(
        blueprintId: string,
        code: string,
        options?: { mergeKey?: string; mergeWindowMs?: number },
    ): void;
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
    renderDocumentSurface(options: RenderDocumentSurfaceOptions): ReactElement | null;
    renderComponent(options: RenderComponentOptions): ReactElement | null;
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

export type InteractionOverrideChange = {
    previous: InteractionOverride | null;
    next: InteractionOverride | null;
};

interface UIEditorStateEvents {
    toolChanged: UITool;
    viewportChanged: ViewportTransform;
    selectionChanged: SelectionState;
    interactionOverrideChanged: InteractionOverrideChange;
    /** Editor-only: appearance variant picker in the inspector (per element); drives canvas preview. */
    appearanceInspectorVariantChanged: { elementId: string };
    /** Outline panel expand/collapse memory (persisted); payload unused. */
    outlineExpansionChanged: null;
    /** Outline panel chrome collapsed state (persisted). */
    outlinePanelCollapsedChanged: boolean;
    /** Smart snap / smart guides toggle (persisted in project settings). */
    smartSnapEnabledChanged: boolean;
    /** Per-category snap targets when smart snap is enabled (persisted). */
    smartSnapDetailSettingsChanged: SmartSnapDetailSettings;
    /** Ephemeral snap guide lines in surface space (viewport overlay). */
    snapGuidesChanged: ActiveSnapGuides | null;
}

interface IUIEditorFontFaceService extends IService {
    acquire(
        assetId: string,
    ): Promise<{ ok: true; cssFamily: string } | { ok: false; error: string }>;
    release(assetId: string): void;
    invalidate(assetId: string): void;
}

interface IBlueprintNodeCatalogService extends IService {
    /** Idempotent: loads core built-in node definitions into the shared registry. */
    ensureBuiltinsRegistered(): void;
    register(def: BlueprintNodeDef, options?: { ownerPluginId?: string; replaceExisting?: boolean }): void;
    registerMany(defs: BlueprintNodeDef[], options?: { ownerPluginId?: string; replaceExisting?: boolean }): void;
    registerDynamicSelectOptionsSource(
        sourceId: string,
        provider: () => BlueprintInspectorParamSelectOption[],
        options?: { ownerPluginId?: string; replaceExisting?: boolean },
    ): () => void;
    getDynamicSelectOptions(): Record<string, BlueprintInspectorParamSelectOption[]>;
    notifyDynamicSelectOptionsChanged(): void;
    onDynamicSelectOptionsChanged(handler: () => void): () => void;
    get(type: string): BlueprintNodeDef | undefined;
    getBlueprintNodeEditorCatalogEntry(type: string): BlueprintNodeEditorCatalogEntry | undefined;
    listPaletteEntries(ctx: BlueprintPaletteContext): BlueprintNodeEditorCatalogEntry[];
    resolveCatalogEntry(type: string): BlueprintNodeEditorCatalogEntry;
    /** Pins merged with instance params (dynamic input pins). */
    resolveCatalogEntryForNode(type: string, params?: Record<string, unknown>): BlueprintNodeEditorCatalogEntry;
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
    /** Cached appearance variant id for inspector authoring (editing-area cache, not saved in UIDocument). */
    getAppearanceInspectorVariant(elementId: string): string | null;
    setAppearanceInspectorVariant(elementId: string, variantId: string): void;
    /** Whether compact Border panel "sides" row is expanded (per element, persisted with project settings). */
    getAppearanceBorderSidesExpanded(elementId: string): boolean;
    setAppearanceBorderSidesExpanded(elementId: string, expanded: boolean): void;
    /** Outline: branch is collapsed when true (editor-only, project settings). */
    isOutlineBranchCollapsed(elementId: string): boolean;
    setOutlineBranchCollapsed(elementId: string, collapsed: boolean): void;
    /** Outline panel chrome: collapsed when true (editor-only global settings). */
    getOutlinePanelCollapsed(): boolean;
    setOutlinePanelCollapsed(collapsed: boolean): void;
    /** When true, dragging/resizing/inserting snaps to surface and sibling guides (project settings). */
    getSmartSnapEnabled(): boolean;
    setSmartSnapEnabled(enabled: boolean): void;
    /** Which guide categories participate when smart snap is on (persisted). */
    getSmartSnapDetailSettings(): SmartSnapDetailSettings;
    patchSmartSnapDetailSettings(patch: Partial<SmartSnapDetailSettings>): void;
    /** Active snap guides for the current interaction (null clears overlay). */
    getSnapGuides(): ActiveSnapGuides | null;
    setSnapGuides(guides: ActiveSnapGuides | null): void;
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

interface IConsoleService extends IService {
    getChannels(): readonly ConsoleChannelDefinition[];
    registerChannel(definition: ConsoleChannelDefinition): () => void;
    getEntries(channel: ConsoleChannelId): ConsoleEntry[];
    append(channel: ConsoleChannelId, input: ConsoleAppendInput): ConsoleEntry;
    log(
        channel: ConsoleChannelId,
        level: ConsoleLogLevel,
        message: string,
        options?: Omit<ConsoleAppendInput, "level" | "message" | "segments">,
    ): ConsoleEntry;
    clear(channel?: ConsoleChannelId): void;
    onEntriesChanged(handler: (event: {
        channel: ConsoleChannelId;
        entries: ConsoleEntry[];
        reason: "append" | "clear";
        entry?: ConsoleEntry;
    }) => void): () => void;
    onChannelsChanged(handler: (event: {
        channels: readonly ConsoleChannelDefinition[];
    }) => void): () => void;
    getProgress(channel: ConsoleChannelId): ConsoleProgress | null;
    setProgress(channel: ConsoleChannelId, input: ConsoleProgressInput | null): void;
    onProgressChanged(handler: (event: {
        channel: ConsoleChannelId;
        progress: ConsoleProgress | null;
    }) => void): () => void;
}

// Editor Services
interface IEditorService extends IService { }

type StoryPluginActionCreateInput = {
    generateId: () => string;
    initialText?: string;
};

type StoryPluginActionRegistration = {
    id: string;
    label: string;
    detail?: string;
    group?: string;
    createBlock: (input: StoryPluginActionCreateInput) => StoryBlock;
};

interface IStoryService extends IService {
    listStories(): StoryLibraryEntry[];
    getStoryEntry(storyId: StoryId): StoryLibraryEntry | undefined;
    getDefaultStoryId(): StoryId | undefined;
    setDefaultStory(storyId: StoryId | undefined): void;
    createStory(name: string): StoryLibraryEntry;
    renameStory(storyId: StoryId, name: string): boolean;
    deleteStory(storyId: StoryId): boolean;
    loadLibrary(): Promise<StoryLibraryIndex>;
    getLibraryIndex(): StoryLibraryIndex;
    onLibraryChanged(handler: (index: StoryLibraryIndex) => void): () => void;
    loadAnimationIndex(): Promise<StoryAnimationIndex>;
    getAnimationIndex(): StoryAnimationIndex;
    listAnimationAssets(): StoryAnimationIndexEntry[];
    loadAnimationAsset(animationId: StoryAnimationAssetId): Promise<StoryAnimationAsset>;
    getLoadedAnimationAsset(animationId: StoryAnimationAssetId): StoryAnimationAsset | undefined;
    createAnimationAsset(input: {
        name: string;
        targetKind?: StoryAnimationIndexEntry["targetKind"];
        timeline?: StoryAnimationTimeline;
        sequences?: StoryAnimationSequence[];
    }): Promise<StoryAnimationAsset>;
    updateAnimationAsset(animationId: StoryAnimationAssetId, updater: (asset: StoryAnimationAsset) => StoryAnimationAsset): StoryAnimationAsset;
    deleteAnimationAsset(animationId: StoryAnimationAssetId): boolean;
    onAnimationsChanged(handler: (index: StoryAnimationIndex) => void): () => void;
    registerPluginAction(registration: StoryPluginActionRegistration): () => void;
    unregisterPluginAction(actionId: string): boolean;
    getPluginAction(actionId: string): StoryPluginActionRegistration | undefined;
    listPluginActions(): StoryPluginActionRegistration[];
    onPluginActionsChanged(handler: (actions: StoryPluginActionRegistration[]) => void): () => void;
    loadStory(storyId: StoryId): Promise<StoryDocument>;
    getStoryDocument(storyId: StoryId): StoryDocument;
    saveStory(storyId: StoryId): Promise<void>;
    flushPendingChanges(): Promise<void>;
    reloadStory(storyId: StoryId): Promise<StoryDocument>;
    onDocumentChanged(handler: (event: { storyId: StoryId; document: StoryDocument }) => void): () => void;
    onDirtyChanged(handler: (dirty: boolean) => void): () => void;
    isDirty(): boolean;
    getRevision(): number;
    createChapter(storyId: StoryId, name: string): StoryChapter;
    renameChapter(storyId: StoryId, chapterId: string, name: string): boolean;
    deleteChapter(storyId: StoryId, chapterId: string): boolean;
    moveChapter(storyId: StoryId, chapterId: string, beforeChapterId: string | null): boolean;
    createScene(storyId: StoryId, input: { chapterId?: string; name: string }): StoryScene;
    renameScene(storyId: StoryId, sceneId: StorySceneId, name: string): boolean;
    updateScene(storyId: StoryId, sceneId: StorySceneId, patch: StorySceneUpdate): boolean;
    deleteScene(storyId: StoryId, sceneId: StorySceneId): boolean;
    moveScene(storyId: StoryId, sceneId: StorySceneId, target: { chapterId: string; beforeSceneId?: string | null }): boolean;
    setEntryScene(storyId: StoryId, sceneId: StorySceneId | undefined): void;
    insertBlock(
        storyId: StoryId,
        sceneId: StorySceneId,
        block: StoryBlock,
        target: { parentId: StoryBlockId | null; beforeBlockId?: StoryBlockId | null },
    ): StoryBlock;
    updateBlock(storyId: StoryId, sceneId: StorySceneId, blockId: StoryBlockId, payload: StoryBlock["payload"]): void;
    deleteBlock(storyId: StoryId, sceneId: StorySceneId, blockId: StoryBlockId): void;
    replaceScene(storyId: StoryId, sceneId: StorySceneId, scene: StoryScene): void;
    moveBlock(
        storyId: StoryId,
        sceneId: StorySceneId,
        blockId: StoryBlockId,
        target: { parentId: StoryBlockId | null; beforeBlockId?: StoryBlockId | null },
    ): void;
    canImportStoryPackage(): false;
    canExportStoryPackage(): false;
}

interface IUIEditorHistoryService extends IService {
    getLimit(): number;
    setLimit(limit: number): void;
    captureSnapshot(surfaceId: string): {
        document: UIDocument;
        blueprint: unknown;
    };
    record(options: {
        surfaceId: string;
        before: ReturnType<IUIEditorHistoryService["captureSnapshot"]>;
        after: ReturnType<IUIEditorHistoryService["captureSnapshot"]>;
        mergeKey?: string;
        mergeWindowMs?: number;
    }): void;
    canUndo(surfaceId: string): boolean;
    canRedo(surfaceId: string): boolean;
    undo(surfaceId: string): boolean;
    redo(surfaceId: string): boolean;
    clear(surfaceId?: string): void;
    on(event: "historyChanged", handler: (data: { surfaceId: string }) => void): () => void;
}

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
    isDirty(): boolean;
    flushPendingChanges(): Promise<void>;
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
    writeFile(data: string | Buffer | Uint8Array): Promise<FsRequestResult<string>>;
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

interface IPreviewService extends IService {
    getStatus(): PreviewStatus;
    refreshStatus(): Promise<PreviewStatus>;
    launch(entry: GameRuntimeLaunchEntry, projectPath?: string): Promise<PreviewStatus>;
    stop(projectPath?: string): Promise<PreviewStatus>;
    onStatusChanged(handler: (status: PreviewStatus) => void): () => void;
}

interface IBuildService extends IService {
    getState(): GameBuildStateSnapshot;
    getStatus(): GameBuildStatus;
    isBuilding(): boolean;
    refreshState(): Promise<GameBuildStateSnapshot>;
    start(request: GameBuildRequest): Promise<GameBuildStateSnapshot>;
    cancel(): Promise<GameBuildStateSnapshot>;
    onStateChanged(handler: (state: GameBuildStateSnapshot) => void): () => void;
}

interface IDebugService extends IService { }

// Helper Services

/**
 * Game localization (player-facing multi-language). Owns the project's
 * localization configuration and the per-locale translation library.
 * Unrelated to the Studio UI i18n framework.
 */
interface ILocalizationService extends IService {
    getConfiguration(): LocalizationConfiguration;
    onConfigChanged(handler: (config: LocalizationConfiguration) => void): () => void;
    addLocale(entry: LocalizationLocaleEntry): Promise<LocalizationConfiguration>;
    removeLocale(code: string): Promise<LocalizationConfiguration>;
    setSourceLocale(code: string): Promise<LocalizationConfiguration>;
    loadDocument(locale: string): Promise<LocalizationDocument>;
    getDocumentIfLoaded(locale: string): LocalizationDocument | undefined;
    onDocumentChanged(handler: (event: { locale: string; document: LocalizationDocument }) => void): () => void;
    flushPendingChanges(): Promise<void>;
}

interface IVersionControlService extends IService { }

// Plugin Services
interface IPluginService extends IService { }

interface IProjectDependencyService extends IService {
    getResolution(): ProjectDependencyResolution | null;
    getSuppressedPluginIds(): string[];
    onResolutionChanged(handler: () => void): () => void;
    resolve(): Promise<ProjectDependencyResolution>;
    previewResolve(): Promise<ProjectDependencyResolution>;
    rescan(): Promise<ProjectDependencyTable>;
    rescanAndPersist(): Promise<ProjectDependencyResolution>;
}

export {
    IAssetService, IAudioService, IBlueprintNodeCatalogService, IBuildService, ICommandService, IDebugService,
    IEditorService, IFileSystemService, IFontService, ILocalizationService, ILoggerService,
    IGlobalSettingsService, IPluginService, IPreviewService, IProjectService, IRuntimeService,
    IService, IServiceAssetsService, IPanelStateService, IStorageService, IStoryService,
    ITextureService, IUIService, IUuidService, IVersionControlService, IVideoService,
    ICharacterService, IUIDocumentService, IUIEditorHistoryService, IUIGraphService, ILocalBlueprintService, IUIBlueprintLifecycleCoordinator,
    IUIRuntimeBridgeService, IUIEditorFontFaceService, IUIEditorStateService, IDevModeService, IConsoleService, UIEditorStateEvents,
    IProjectDependencyService,
    Services, WorkspaceContext
};

export type { ActiveSnapGuides, SmartSnapDetailSettings };
export type { StoryPluginActionCreateInput, StoryPluginActionRegistration };
