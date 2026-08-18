import { FsRequestResult } from "@shared/types/os";
import type { FsTextEncoding } from "@shared/types/textEncoding";
import { FileDetails, FileStat, FileEntry, DirectorySizeResult } from "@shared/utils/fs";
import { Porject, ProjectConfig, ProjectMetadata } from "../project/project";
import type { ProjectIconSet, ProjectIconSource } from "@shared/types/projectIcons";
import type {
    LintingConfiguration,
    MobileConfiguration,
    NetworkConfiguration,
    SecurityConfiguration,
    WebOptimizationConfiguration,
} from "../project/configuration";
import type { LintContext } from "@/lib/lint/context";
import type { LintReport } from "@/lib/lint/types";
import type { LintRunOptions } from "@/lib/lint/engine";
import type { RegisteredTest, TestAvailability, TestId, TestRunRecord } from "@/lib/testing/types";
import type {
    LocalizationConfiguration,
    LocalizationDocument,
    LocalizationLocaleEntry,
} from "@shared/types/localization";
import type {
    VoiceConfiguration,
    VoiceDocument,
    VoiceLocaleEntry,
} from "@shared/types/voice";
import type { ProjectDependencyResolution, ProjectDependencyTable } from "@shared/types/pluginDependencies";
import type {
    RevisionId,
    VcsAvailability,
    VcsCheckpointReason,
    VcsCommitOptions,
    VcsCommitResult,
    VcsFileChange,
    VcsHistoryEntry,
    VcsInitOptions,
    VcsRepositoryInfo,
    VcsRestoreOptions,
    VcsRestoreResult,
    VcsStatus,
} from "@shared/types/vcs";
import type { WorkspaceFreezeReason } from "../../app/writeFreeze";
import type {
    ExternalReloadParticipant,
    WorkspaceReloadCause,
    WorkspaceReloadResult,
} from "./core/WorkspaceReloadService";
import type { DocumentSource } from "@shared/documents/documentSource";
import { Asset, AssetsMap, AssetSource } from "./assets/types";
import type { HistoryLabel } from "./history/historyModel";
import { ServiceRegistry } from "./serviceRegistry";
import { AssetCategory, AssetData, AssetType } from "./assets/assetTypes";
import { RequestStatus } from "@shared/types/ipcEvents";
import { Character } from "./character/Character";
import { CharacterAppearanceKind, CharacterGroup } from "./character/types";
import type { PuppetDescription } from "narraleaf-react";
import type { PuppetDescriptionRequest, PuppetDescriptionResult } from "./puppet/puppetDescriptionModel";
import type { MediaAssetSupportRecord } from "./media/mediaAssetSupport";
import type { MediaSupportScan } from "./media/MediaSupportService";
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
    BlueprintPersistentVariable,
    BlueprintPrivateOwnerRecord,
    Blueprint,
    LiteralValue,
} from "@shared/types/blueprint/document";
import type { VariableRegistry, VariableRegistryEntry, VariableRegistryScope } from "@shared/types/variables/registry";
import type { AudioTrackChannel, ProjectAudioTrack, ProjectAudioTrackDocument } from "@shared/types/audioTrack";
import type {
    AppTagBaseIdentity,
    AppTagIdentity,
    AppTagOverrideKey,
    AppTagPluginConfig,
    AppTagResolvedValue,
    ProjectAppTag,
    ProjectAppTagDocument,
} from "@shared/types/appTag";
import type { PluginBuildConfigField } from "@shared/types/plugins";
import type { BrandColor, ProjectBrandDocument } from "@shared/types/brand";
import type { ProjectDictionaryDocument } from "@shared/types/dictionary";
import type { SpellcheckStatus } from "@shared/types/spellcheck";
import type { SaveSchema, SaveSchemaField, SaveSchemaFieldType } from "@shared/types/saveSchema";
import type { BrandPalette } from "@shared/brand/brandRegistry";
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
import type { SurfaceViewportFit } from "../../ui-editor/geometry/fitViewport";
import type { UITool } from "../../ui-editor/editor/types";
import type { ActiveSnapGuides, SmartSnapDetailSettings } from "../../ui-editor/snapping/types";
import type { SelectionState } from "./ui/UIStore";
import type { DevModeEntry, DevModeStatus } from "@shared/types/devMode";
import type { GameRuntimeLaunchEntry, PreviewStatus } from "@shared/types/gameRuntime";
import type {
    GameBuildPlatform,
    GameBuildRequest,
    GameBuildStateSnapshot,
    GameBuildStatus,
} from "@shared/types/gameBuild";
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
    StoryLiteralValue,
    StoryScene,
    StorySceneId,
    StorySceneUpdate,
    StoryVariableValueType,
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
    /** Every undo stack in the workspace, scoped by document; see `history/HistoryService` */
    History = "history",
    UIEditorHistory = "uiEditorHistory",
    UIGraph = "uiGraph",
    LocalBlueprint = "localBlueprint",
    UIBlueprintLifecycle = "uiBlueprintLifecycle",
    DevMode = "devMode",
    Preview = "preview",
    Build = "build",
    /** Project-wide lint: context assembly, the rule sweep, and the last report */
    Lint = "lint",
    /** Tests against the author's game: the registry, the one run slot, and this session's history */
    TestRun = "testRun",
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
    /** Asset reverse-lookup index: which stories, blueprints, widgets and takes use a given asset */
    Reference = "reference",
    // Logger = "logger",
    // Editor = "editor",
    Story = "story",
    Character = "character",
    Assets = "assets",
    /** What a puppet's model says it contains — motions, expressions, skins, parameters */
    PuppetDescription = "puppetDescription",
    /** Which media assets already in the project will not play, and what to convert them into */
    MediaSupport = "mediaSupport",
    /** Per-project plugin dependency table: scan, persist, and resolve compatibility */
    ProjectDependency = "projectDependency",
    /** Accumulated authoring activity (writing curve, active time, build history) */
    ProjectStats = "projectStats",
    /** Project-level persistent variable registry (blueprint-declared persistent vars); M-VAR */
    VariableRegistry = "variableRegistry",
    /** Project-level audio tracks: the authoring-time mix presets every audio surface points at */
    AudioTracks = "audioTracks",
    /** The build variants the project ships as, and what each one says differently from the project */
    AppTags = "appTags",
    /** The asset sets the project declares: library entries standing for a family of files, by axis */
    AssetSets = "assetSets",
    /** The project's own palette: the colours every `nlbrand:` link in the project resolves through */
    Brand = "brand",
    /** The words the project spells on purpose, and the session's spellchecker they are pushed into */
    Dictionary = "dictionary",
    /** What one save slot carries besides the engine's own record; grows the pins on the save nodes */
    SaveSchema = "saveSchema",
    /** Aggregate "is my work on disk?" state: auto-saver states + the table of files that failed */
    SaveStatus = "saveStatus",
    // Texture = "texture",
    // Audio = "audio",
    // Video = "video",
    // Font = "font",
    // Runtime = "runtime",
    // Build = "build",
    // Debug = "debug",
    Localization = "localization",
    Voice = "voice",
    /** Repository state for this project: availability, status snapshot, history */
    VersionControl = "versionControl",
    /** Whether project data may be written at all, and why not - the write-boundary freeze */
    WorkspaceFreeze = "workspaceFreeze",
    /** "The working tree changed under the editors": drops in-memory documents and re-reads them */
    WorkspaceReload = "workspaceReload",
    /** Recovery mode's own state: which subsystems have been tried, and what they said */
    Recovery = "recovery",
    // Plugin = "plugin",
}

// Core Services
interface IProjectService extends IService {
    getProjectConfig(): ProjectConfig;
    reloadProjectConfig(): Promise<ProjectConfig>;
    updateProjectConfig(updater: (config: ProjectConfig) => ProjectConfig): Promise<ProjectConfig>;
    updateProjectName(name: string): Promise<ProjectConfig>;
    updateProjectMetadata(patch: Partial<ProjectMetadata>): Promise<ProjectConfig>;
    getNetworkConfiguration(): NetworkConfiguration;
    updateNetworkConfiguration(patch: Partial<NetworkConfiguration>): Promise<ProjectConfig>;
    getSecurityConfiguration(): SecurityConfiguration;
    updateSecurityConfiguration(patch: Partial<SecurityConfiguration>): Promise<ProjectConfig>;
    getWebOptimizationConfiguration(): WebOptimizationConfiguration;
    updateWebOptimizationConfiguration(patch: Partial<WebOptimizationConfiguration>): Promise<ProjectConfig>;
    getLintingConfiguration(): LintingConfiguration;
    updateLintingConfiguration(patch: Partial<LintingConfiguration>): Promise<ProjectConfig>;
    updateMobileConfiguration(patch: Partial<MobileConfiguration>): Promise<ProjectConfig>;
    getProjectIconSet(): ProjectIconSet;
    updateProjectIconSet(updater: (set: ProjectIconSet) => ProjectIconSet): Promise<ProjectIconSet>;
    importProjectIconSource(slot: string): Promise<{ source: ProjectIconSource; bytes: Uint8Array } | null>;
    readProjectIconFile(relativePath: string): Promise<Uint8Array | null>;
    projectIconFileExists(relativePath: string): Promise<boolean>;
    writeProjectIconBake(relativePath: string, bytes: Uint8Array): Promise<boolean>;
    deleteProjectIconFile(relativePath: string): Promise<void>;
    getDependencyTable(): ProjectDependencyTable | undefined;
    setDependencyTable(table: ProjectDependencyTable | undefined): Promise<ProjectConfig>;
}

interface IUuidService extends IService {
    generate(compact?: boolean): string;
}

interface IFileSystemService extends IService {
    stat(path: string): Promise<FsRequestResult<FileStat>>;
    list(path: string): Promise<FsRequestResult<FileEntry[]>>;
    details(path: string): Promise<FsRequestResult<FileDetails>>;
    directorySize(path: string): Promise<FsRequestResult<DirectorySizeResult>>;
    read(path: string, encoding: FsTextEncoding): Promise<FsRequestResult<string>>;
    readRaw(path: string): Promise<FsRequestResult<Uint8Array>>;
    write(path: string, data: string, encoding: FsTextEncoding): Promise<FsRequestResult<void>>;
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
    updateSurface(
        surfaceId: string,
        updater: (surface: UISurface) => void,
        options?: { mergeKey?: string },
    ): void;
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
     * Does not remove the graph from the blueprint document - call LocalBlueprintService.removeEventGraph after.
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
    /** One-shot: the raw persistent variables read at load before the M-VAR migration relocated them. */
    consumeLegacyPersistentVariables(): Record<string, BlueprintPersistentVariable> | null;
}

interface IVariableRegistryService extends IService {
    load(): Promise<VariableRegistry>;
    save(registry: VariableRegistry): Promise<void>;
    getRegistry(): VariableRegistry;
    listEntries(): VariableRegistryEntry[];
    listEntriesInScope(scope: VariableRegistryScope): VariableRegistryEntry[];
    getEntry(id: string): VariableRegistryEntry | undefined;
    onRegistryChanged(handler: (registry: VariableRegistry) => void): () => void;
    onDirtyChanged(handler: (dirty: boolean) => void): () => void;
    isDirty(): boolean;
    getRevision(): number;
    applyRegistryMutation(mutator: (registry: VariableRegistry) => void): void;
    createEntry(
        scope: VariableRegistryScope,
        input?: { name?: string; valueType?: string; defaultValue?: StoryLiteralValue; description?: string },
    ): VariableRegistryEntry;
    renameEntry(id: string, name: string): void;
    setEntryValueType(id: string, valueType: StoryVariableValueType): void;
    setEntryDefault(id: string, defaultValue: StoryLiteralValue | undefined): void;
    setEntryDescription(id: string, description: string | undefined): void;
    deleteEntry(id: string): void;
    replaceRegistry(registry: VariableRegistry): void;
}

/**
 * The project's audio buses - a tree of mixer strips, each with a parent, its own live gain and a
 * default loop policy. See `@shared/types/audioTrack` for the model.
 */
interface IAudioTrackService extends IService {
    load(): Promise<ProjectAudioTrack[]>;
    save(document: ProjectAudioTrackDocument): Promise<void>;
    getDocument(): ProjectAudioTrackDocument;
    listTracks(): ProjectAudioTrack[];
    getTrack(id: string): ProjectAudioTrack | undefined;
    resolveTrack(trackId: string | null | undefined, fallbackChannel?: AudioTrackChannel): ProjectAudioTrack;
    onTracksChanged(handler: (tracks: ProjectAudioTrack[]) => void): () => void;
    onDirtyChanged(handler: (dirty: boolean) => void): () => void;
    isDirty(): boolean;
    getRevision(): number;
    applyTrackMutation(mutator: (tracks: ProjectAudioTrack[]) => ProjectAudioTrack[], label?: HistoryLabel): void;
    createTrack(input?: Partial<Omit<ProjectAudioTrack, "id" | "builtin">>): ProjectAudioTrack;
    duplicateTrack(id: string): ProjectAudioTrack | null;
    updateTrack(id: string, patch: Partial<Omit<ProjectAudioTrack, "id" | "builtin" | "parentId">>): void;
    renameTrack(id: string, name: string): boolean;
    /** False for itself, for one of its own descendants, and for a parent that is not there. */
    canReparentTrack(id: string, parentId: string | null): boolean;
    reparentTrack(id: string, parentId: string | null): boolean;
    /** Refuses the three seeded buses; promotes the children of whatever it does delete. */
    deleteTrack(id: string): boolean;
    moveTrack(id: string, beforeId: string | null): void;
}

/**
 * The project's build variants - what the same project can be shipped as, and what each variant says
 * differently from the project itself. See `@shared/types/appTag` for the model.
 *
 * Every read answers: the release tag is prepended rather than stored, so a project with no document
 * still has one tag and an unknown id still resolves.
 */
interface IAppTagService extends IService {
    load(): Promise<ProjectAppTag[]>;
    save(document: ProjectAppTagDocument): Promise<void>;
    getDocument(): ProjectAppTagDocument;
    /** Release first, then the author's own. */
    listTags(): ProjectAppTag[];
    listAuthoredTags(): ProjectAppTag[];
    getTag(id: string): ProjectAppTag | undefined;
    /** Whether the project has a tag under this id. Always true for the release tag. */
    hasTag(id: string | null | undefined): boolean;
    /** Total: an unknown or blank id answers the release tag. */
    resolveTag(id: string | null | undefined): ProjectAppTag;
    resolveIdentity(id: string | null | undefined, base: AppTagBaseIdentity): AppTagIdentity;
    onTagsChanged(handler: (tags: ProjectAppTag[]) => void): () => void;
    onDirtyChanged(handler: (dirty: boolean) => void): () => void;
    isDirty(): boolean;
    getRevision(): number;
    applyTagMutation(mutator: (tags: ProjectAppTag[]) => ProjectAppTag[], label?: HistoryLabel): void;
    createTag(input?: { name?: string }): ProjectAppTag;
    /** Refuses the release tag and a blank name. Stored references hold the id, so they follow. */
    renameTag(id: string, name: string): boolean;
    /** A blank value clears the key instead of storing it. */
    setOverride(id: string, key: AppTagOverrideKey, value: string): boolean;
    /** Restore one key to the inherited value by removing it. */
    clearOverride(id: string, key: AppTagOverrideKey): boolean;
    clearAllOverrides(id: string): boolean;
    listOverriddenKeys(id: string): AppTagOverrideKey[];
    /** The project's own plugin build values - what a variant states nothing against. */
    getProjectPluginConfig(): AppTagPluginConfig;
    /** Only what this variant states. Empty for the release tag, which stores nothing. */
    getVariantPluginConfig(id: string | null | undefined): AppTagPluginConfig;
    resolvePluginConfigValue(
        id: string | null | undefined,
        field: PluginBuildConfigField,
        platform?: GameBuildPlatform,
    ): AppTagResolvedValue;
    /** Routed by the field's scope; a blank value clears it. */
    setPluginConfigValue(
        id: string | null | undefined,
        field: PluginBuildConfigField,
        value: string,
        platform?: GameBuildPlatform,
    ): boolean;
    /** Restore one field to the inherited value by removing it. */
    clearPluginConfigValue(
        id: string | null | undefined,
        field: PluginBuildConfigField,
        platform?: GameBuildPlatform,
    ): boolean;
    clearAllPluginConfig(id: string): boolean;
    /** Refuses the release tag. References are not rewritten; they resolve to release. */
    deleteTag(id: string): boolean;
}

/**
 * The project's palette - the colours a `nlbrand:` link resolves through. See `@shared/types/brand`
 * for the model and `@shared/brand/brandRegistry` for the resolution.
 *
 * Besides owning the document it *publishes*: every mutation pushes the new list to the module-level
 * active palette, which is what the colour fields themselves read.
 */
interface IBrandService extends IService {
    load(): Promise<BrandColor[]>;
    save(document: ProjectBrandDocument): Promise<void>;
    getDocument(): ProjectBrandDocument;
    listColors(): BrandColor[];
    getColor(id: string): BrandColor | undefined;
    /** The resolved palette, for previewing an id. Same object the rest of the window paints from. */
    getPalette(): BrandPalette;
    onColorsChanged(handler: (colors: BrandColor[]) => void): () => void;
    onDirtyChanged(handler: (dirty: boolean) => void): () => void;
    isDirty(): boolean;
    getRevision(): number;
    createColor(input?: { name?: string; value?: string }): BrandColor;
    renameColor(id: string, name: string): boolean;
    updateColor(id: string, patch: { name?: string; value?: string }): void;
    /** Refuses the seeded slots: the control appearances point at them, so they exist at all times. */
    deleteColor(id: string): boolean;
    moveColor(id: string, beforeId: string | null): void;
    replaceDocument(document: ProjectBrandDocument): void;
    flushPendingChanges(): Promise<void>;
}

/**
 * The words the project spells on purpose - character names, place names, invented terms. See
 * `@shared/types/dictionary` for the model.
 *
 * Besides owning the document it *publishes*: every change pushes the list into Chromium's session
 * dictionary, which is machine-scoped and therefore has to be handed back when the project closes.
 */
interface IDictionaryService extends IService {
    load(): Promise<string[]>;
    save(document: ProjectDictionaryDocument): Promise<void>;
    getDocument(): ProjectDictionaryDocument;
    listWords(): string[];
    hasWord(word: string): boolean;
    /** `false` when there was nothing to add: a blank, or a word the project already spells. */
    addWord(word: string): boolean;
    /** `false` when the project never held it. */
    removeWord(word: string): boolean;
    replaceDocument(document: ProjectDictionaryDocument): void;
    /** What the spellchecker settled on at the last push; `null` before the first one. */
    getSpellcheckStatus(): SpellcheckStatus | null;
    /** The language settled on, whenever it changes - so an open story row can re-check. */
    onStatusChanged(handler: (status: SpellcheckStatus | null) => void): () => void;
    onWordsChanged(handler: (words: string[]) => void): () => void;
    onDirtyChanged(handler: (dirty: boolean) => void): () => void;
    isDirty(): boolean;
    getRevision(): number;
}

/**
 * What one save slot carries besides the engine's own record. See `@shared/types/saveSchema` for
 * the model and `@shared/saves/saveSchemaModel` for the operations over it.
 *
 * One document per project on purpose: `Save Game` and `Get Save Metadata` are a contract across
 * time, so a schema stored per node would be as many copies as there are save nodes, drifting by
 * hand and failing silently.
 */
interface ISaveSchemaService extends IService {
    load(): Promise<SaveSchema>;
    save(schema: SaveSchema): Promise<void>;
    getSchema(): SaveSchema;
    /** Every declared field in pin order. */
    listFields(): SaveSchemaField[];
    getField(id: string): SaveSchemaField | undefined;
    onSchemaChanged(handler: (schema: SaveSchema) => void): () => void;
    onDirtyChanged(handler: (dirty: boolean) => void): () => void;
    isDirty(): boolean;
    getRevision(): number;
    createField(input?: { name?: string; valueType?: SaveSchemaFieldType }): SaveSchemaField;
    /** `id` and `storageKey` are not patchable - one names every pin, the other keys every save. */
    updateField(
        id: string,
        patch: { name?: string; valueType?: SaveSchemaFieldType; defaultValue?: LiteralValue; description?: string },
    ): void;
    deleteField(id: string): boolean;
    moveField(id: string, beforeId: string | null): void;
    replaceSchema(schema: SaveSchema): void;
    flushPendingChanges(): Promise<void>;
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
    ): VariableRegistryEntry;
    renamePersistentVariable(historyBlueprintId: string, variableId: string, name: string): void;
    setPersistentVariableDefault(
        historyBlueprintId: string,
        variableId: string,
        defaultValue: import("@shared/types/blueprint/document").LiteralValue | undefined,
    ): void;
    setPersistentVariableValueType(
        historyBlueprintId: string,
        variableId: string,
        valueType: StoryVariableValueType,
    ): void;
    deletePersistentVariable(historyBlueprintId: string, variableId: string): void;
    listPersistentVariables(): VariableRegistryEntry[];
    listSavedVariables(): VariableRegistryEntry[];
    createSavedRegistryVariable(
        historyBlueprintId: string,
        input?: {
            name?: string;
            valueType?: string;
            defaultValue?: import("@shared/types/blueprint/document").LiteralValue;
        },
    ): VariableRegistryEntry;
    renameSavedRegistryVariable(historyBlueprintId: string, variableId: string, name: string): void;
    setSavedRegistryVariableDefault(
        historyBlueprintId: string,
        variableId: string,
        defaultValue: import("@shared/types/blueprint/document").LiteralValue | undefined,
    ): void;
    setSavedRegistryVariableValueType(
        historyBlueprintId: string,
        variableId: string,
        valueType: StoryVariableValueType,
    ): void;
    deleteSavedRegistryVariable(historyBlueprintId: string, variableId: string): void;
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

/**
 * The one element showing a state other than the one it rests in, and which state that is.
 *
 * Editor-only and never persisted: it says what the author is looking at this minute, and a stale
 * one restored at startup would be a canvas that quietly disagrees with the document. `variantId`
 * is null for the resting state, which is also what descendants carrying no variant of that id
 * resolve to - so one value describes the whole subtree.
 *
 * `surfaceId` is what it is scoped to. Selection is deliberately not: clicking a widget's part on the
 * canvas promotes the selection to the parent it drills from, so a rule that exits the state when the
 * selection leaves the subtree exits it on the very click an author makes to grab the thing they are
 * editing.
 */
export type UIEditorEnteredState = { surfaceId: string; elementId: string; variantId: string | null };

interface UIEditorStateEvents {
    toolChanged: UITool;
    viewportChanged: ViewportTransform;
    selectionChanged: SelectionState;
    interactionOverrideChanged: InteractionOverrideChange;
    /** Editor-only: which element is showing one of its states, and which; drives canvas preview. */
    enteredStateChanged: UIEditorEnteredState | null;
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
    /** Screen-ratio preview frame preset id, `null` = off (pure view state, global settings). */
    previewAspectChanged: string | null;
    /** Safe-area preview frame device preset id, `null` = off (pure view state, global settings). */
    previewSafeAreaChanged: string | null;
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
    /** A hand gesture (zoom, pan, or a typed zoom); ends the fit mode the interface was following. */
    updateViewport(transform: Partial<ViewportTransform>): ViewportTransform;
    /** Which interface the current transform describes; `null` before any editor tab claimed it. */
    getViewportSurfaceId(): string | null;
    /** The fit mode in force, or `null` once the author moved the view by hand. */
    getViewportFit(): SurfaceViewportFit | null;
    /** Installs a computed zoom for an interface (stays live across resizes, unlike a hand gesture). */
    applyFittedViewport(surfaceId: string, transform: ViewportTransform, fit: SurfaceViewportFit): ViewportTransform;
    /** Restores a hand-set view (`null`), or returns the mode the caller must recompute. */
    adoptSurfaceViewport(surfaceId: string): SurfaceViewportFit | null;
    getSelection(): SelectionState;
    setSelection(selection: SelectionState): void;
    setUIElementSelection(selection: UIElementSelection): void;
    getDocument(): UIDocument;
    getSurface(surfaceId: string): UISurface | undefined;
    /** The state being shown on the canvas right now, or null while every element rests. */
    getEnteredState(): UIEditorEnteredState | null;
    setEnteredState(next: UIEditorEnteredState | null): void;
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
    /**
     * Screen-ratio preview frame preset id (`null` = off). Pure view state: persisted in global
     * settings, never in the UIDocument, so toggling it cannot dirty the project.
     */
    getPreviewAspectId(): string | null;
    setPreviewAspectId(aspectId: string | null): void;
    /** Safe-area preview frame device preset id (`null` = off). Pure view state, see above. */
    getPreviewSafeAreaId(): string | null;
    setPreviewSafeAreaId(safeAreaId: string | null): void;
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
    /** Asynchronous: undo needs the document, which may only be on disk. */
    deleteStory(storyId: StoryId): Promise<boolean>;
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
    deleteAnimationAsset(animationId: StoryAnimationAssetId): Promise<boolean>;
    onAnimationsChanged(handler: (index: StoryAnimationIndex) => void): () => void;
    registerPluginAction(registration: StoryPluginActionRegistration, ownerPluginId?: string): () => void;
    getContributingPluginIds(): string[];
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
    moveBlocks(
        storyId: StoryId,
        sceneId: StorySceneId,
        moves: { blockIds: StoryBlockId[]; target: { parentId: StoryBlockId | null; beforeBlockId?: StoryBlockId | null } }[],
    ): void;
    canImportStoryPackage(): false;
    canExportStoryPackage(): false;
}

/**
 * The workspace's undo stacks. Structural only - the concrete types live with the implementation
 * (`history/HistoryService`), because a scope's snapshot type is whatever its owner says it is.
 */
interface IHistoryService extends IService {
    canUndo(scopeId?: string): boolean;
    canRedo(scopeId?: string): boolean;
    undo(scopeId?: string): boolean;
    redo(scopeId?: string): boolean;
    clearScope(scopeId: string): void;
    clearAll(): void;
    setActiveScope(scopeId: string | null): void;
    getActiveScopeId(): string | null;
    isRestoring(): boolean;
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
    createCharacter(name: string, kind?: CharacterAppearanceKind): Character;
    renameCharacter(id: string, name: string): boolean;
    /** Asynchronous because the baked avatar has to be read before it is deleted, for undo. */
    deleteCharacter(id: string): Promise<boolean>;
    listGroups(): CharacterGroup[];
    getGroup(id: string): CharacterGroup | undefined;
    createGroup(name: string): CharacterGroup;
    renameGroup(id: string, name: string): boolean;
    deleteGroup(id: string): Promise<boolean>;
    assignCharacterToGroup(characterId: string, groupId?: string): boolean;
    listCharactersByGroup(groupId?: string): Character[];
    isDirty(): boolean;
    flushPendingChanges(): Promise<void>;
}

/**
 * What a puppet's model contains, read out of the live model rather than parsed off disk.
 *
 * The one lookup any surface can use: a character inspector filling its controls, a story row
 * offering the motions a character actually has. Nothing here throws at a caller — a project with
 * no runtime installed, a runtime that does not describe its models, and a model that failed to
 * load all come back as `{status: "unavailable"}` with a reason, and the caller falls back to
 * letting the author type a name.
 */
interface IPuppetDescriptionService extends IService {
    describe(request: PuppetDescriptionRequest, options?: { refresh?: boolean }): Promise<PuppetDescriptionResult>;
    describeCharacter(characterId: string, options?: { refresh?: boolean }): Promise<PuppetDescriptionResult>;
    /** What is already in memory, for render paths that cannot await. Null means "ask, then re-render". */
    peek(request: PuppetDescriptionRequest): PuppetDescription | null;
    /** The same look addressed by character - what the story editor holds. Null for a non-puppet, or for an answer not in yet. */
    peekCharacter(characterId: string): PuppetDescription | null;
    invalidate(request?: PuppetDescriptionRequest): Promise<void>;
    onDescriptionChanged(handler: () => void): () => void;
}

/**
 * Whether the media already in the project will play, and what to convert it into if not.
 *
 * The counterpart to the import gate: that one asks about a file the author is holding, this one
 * asks about the library, where assets imported before the gate existed (or imported deliberately
 * unconverted) are still sitting. Answers are cached under the content hash in `editor/cache/`, so
 * a build asks without paying for a probe per file.
 *
 * An unanswered probe is never a verdict: a host with no ffprobe leaves every sound and video asset
 * without a record and reports `probeAvailable: false`, and callers must treat that as "not known",
 * not as "fine" and not as "broken".
 */
interface IMediaSupportService extends IService {
    scan(options?: { force?: boolean }): Promise<MediaSupportScan>;
    getLastScan(): MediaSupportScan;
    /** The last scan's answer for one asset, for render paths that cannot await. */
    peek(assetId: string): MediaAssetSupportRecord | null;
    listUnplayable(): { asset: Asset; record: MediaAssetSupportRecord }[];
    refresh(assetId: string): Promise<void>;
    onChanged(handler: () => void): () => void;
}

// Asset Services
interface IAssetService extends IService {
    getAssets(): AssetsMap;

    list<T extends AssetType>(type: T): string[];
    fetch<T extends AssetType>(asset: Asset<T, AssetSource>): Promise<RequestStatus<AssetData<T>>>;
    exists<T extends AssetType>(asset: Asset<T, AssetSource>): boolean;
    importLocalAssets<T extends AssetType>(type: T): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>>;
    importRemoteAsset(category: AssetCategory, url: string, groupId?: string): Promise<RequestStatus<Asset<AssetType, AssetSource.Remote>>>;
    refreshRemoteAsset<T extends AssetType>(asset: Asset<T, AssetSource.Remote>): Promise<RequestStatus<{ asset: Asset<T, AssetSource>; changed: boolean }>>;
    hasRemoteSnapshot(assetId: string): Promise<boolean>;
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

/**
 * Project-wide lint. `run()` is a read-only sweep, so it stays available while the workspace is
 * frozen (ruling R3) - see LintService.
 */
interface ILintService extends IService {
    buildContext(): Promise<LintContext>;
    run(options?: LintRunOptions): Promise<LintReport>;
    isRunning(): boolean;
    getLastReport(): LintReport | null;
    onReportChanged(handler: (report: LintReport | null) => void): () => void;
}

/**
 * Test runs against the author's game (see `@/lib/testing`).
 *
 * One run at a time per project (ruling R7): `start` rejects while another is active, because a run
 * contends with Dev Mode and Preview for the same compiled artifacts and the same Stop affordance.
 * `getAvailability` is the definition's own answer with the host's gates on top - notably that a
 * `windowed` test is unavailable while the workspace is frozen, while a `headless` one stays
 * available exactly as `lint:project` does (ruling R9).
 */
interface ITestRunService extends IService {
    listTests(): RegisteredTest[];
    getAvailability(id: TestId): TestAvailability;
    /** Resolves the run id once the run is accepted - not when it finishes. */
    start(testId: TestId): Promise<string>;
    cancel(runId: string): void;
    getActiveRun(): TestRunRecord | null;
    getRun(runId: string): TestRunRecord | null;
    /** This session's history, newest first. Never persisted: a verdict is about a moment. */
    listRuns(): TestRunRecord[];
    onChanged(listener: () => void): () => void;
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
    /** Edit a language's display name and fallback. Rejects a fallback that would never be read. */
    updateLocaleEntry(
        code: string,
        patch: Partial<Pick<LocalizationLocaleEntry, "displayName" | "fallback">>,
    ): Promise<LocalizationConfiguration>;
    loadDocument(locale: string): Promise<LocalizationDocument>;
    getDocumentIfLoaded(locale: string): LocalizationDocument | undefined;
    onDocumentChanged(handler: (event: { locale: string; document: LocalizationDocument }) => void): () => void;
    flushPendingChanges(): Promise<void>;
}

/**
 * Game voice-over service: per-locale voice libraries linking story lines to
 * imported audio assets. Voice languages are independent of localization
 * locales (dub language ≠ subtitle language).
 */
interface IVoiceService extends IService {
    getConfiguration(): VoiceConfiguration;
    onConfigChanged(handler: (config: VoiceConfiguration) => void): () => void;
    addLocale(entry: VoiceLocaleEntry): Promise<VoiceConfiguration>;
    removeLocale(code: string): Promise<VoiceConfiguration>;
    loadDocument(locale: string): Promise<VoiceDocument>;
    getDocumentIfLoaded(locale: string): VoiceDocument | undefined;
    onDocumentChanged(handler: (event: { locale: string; document: VoiceDocument }) => void): () => void;
    /** Pull in whatever `getLineText` needs for this voice language before reading it. */
    loadLineTexts(locale: string): Promise<void>;
    /** The line as the actor for this voice language reads it - the translation when there is one. */
    getLineText(locale: string, unitId: string, sourceText: string): string;
    flushPendingChanges(): Promise<void>;
}

/**
 * Version control, scoped to this window's project. `getAvailability` first - the
 * feature is optional and absent on macOS Intel / Windows ARM64 - and nothing here is
 * safe to poll: the scan behind `refreshStatus` writes staged state.
 */
interface IVersionControlService extends IService {
    getAvailability(): Promise<VcsAvailability>;
    isRepository(): Promise<boolean>;
    getInfo(): Promise<VcsRepositoryInfo | null>;
    /** `includeDetails` costs one backend call per revision; leave it off unless they are shown. */
    getHistory(limit?: number, options?: { includeDetails?: boolean }): Promise<VcsHistoryEntry[]>;
    readBlob(revision: RevisionId, path: string): Promise<Uint8Array>;
    /** The same file on disk now; `null` = it is there and too large to hand over. */
    readWorkingFile(path: string): Promise<Uint8Array | null>;
    /** Every document at one revision in one round trip; `null` = absent at that revision. */
    readRevisionDocuments(revision: RevisionId, paths?: readonly string[]): Promise<Map<string, string | null>>;
    /** Show a past revision in the real editors. Freezes first; awaitable because it may go to the network. */
    showRevision(revision: RevisionId, label?: string): Promise<void>;
    /** Leave a revision view: the working tree is read back in and writes are allowed again. */
    showWorkingTree(): void;
    /**
     * Overwrite the working tree with one revision and record the result as a new one.
     *
     * The only method here that changes the author's files. Checkpoints first, never removes a
     * revision, and leaves the version view + re-reads every document before it resolves.
     */
    restoreRevision(revision: RevisionId, options?: VcsRestoreOptions): Promise<VcsRestoreResult>;
    /** The revision the editors are showing, or null for the working tree. */
    getShownRevision(): RevisionId | null;
    getChangedPaths(from: RevisionId, to: RevisionId): Promise<string[]>;
    initRepository(options?: VcsInitOptions): Promise<VcsRepositoryInfo>;
    /** Flushes pending saves, stages, commits, and waits for durability. Throws on failure. */
    commit(options?: VcsCommitOptions): Promise<VcsCommitResult>;
    /** Same pipeline, labelled a checkpoint. Null when there was nothing to record. */
    createCheckpoint(reason: VcsCheckpointReason): Promise<VcsCommitResult | null>;
    /** Scans. Only ever from an explicit request; see VersionControlService. */
    refreshStatus(): Promise<VcsStatus | null>;
    /** The last scan's snapshot, without scanning. */
    getStatus(): VcsStatus | null;
    /** The snapshot's files with directories dropped; `counts` stays as reported. */
    getChangedFiles(): VcsFileChange[];
    invalidateHistory(): void;
    onStatusChanged(handler: (status: VcsStatus | null) => void): () => void;
}

/**
 * The workspace-wide "may project data be written?" latch. Enforced at the write boundary, not by
 * the components - see WorkspaceFreezeService. Session-only; never persisted.
 */
interface IWorkspaceFreezeService extends IService {
    /** Flushes what is owed, then stops project-data writes. */
    freeze(reason: WorkspaceFreezeReason): Promise<void>;
    /**
     * Freeze, then re-read every document out of a past revision. `thaw` comes back.
     *
     * Slow, and awaitable for that reason: the first read of a revision on a project with a remote
     * goes to the network. Takes no checkpoint - browsing history has zero side effects.
     */
    showRevision(source: DocumentSource, label?: string): Promise<WorkspaceReloadResult>;
    /**
     * Keep the workspace in its current view - `thaw` refuses - until the returned function runs.
     *
     * For anything that rewrites project files from outside the editors: leaving mid-rewrite re-reads
     * a half-written tree. Not a version-control flag; see the implementation for why that matters.
     */
    holdRelease(): () => void;
    /** Whether anything is holding the workspace in its current view. */
    isReleaseHeld(): boolean;
    thaw(): void;
    isFrozen(): boolean;
    /** Why the workspace is frozen, or null when it is not. */
    getReason(): WorkspaceFreezeReason | null;
    onChanged(handler: (reason: WorkspaceFreezeReason | null) => void): () => void;
}

/**
 * "The working tree is no longer what the editors are showing." Drops every in-memory document and
 * re-reads it, with project writes held off for the whole pass. Thaw is the first caller, restore
 * (`vcs:working-tree-changed`) the second - see WorkspaceReloadService, whose participant table is
 * the single place that names everything taking part.
 */
interface IWorkspaceReloadService extends IService {
    /** `source` defaults to the working tree, which is what every caller means unless it says so. */
    reload(cause: WorkspaceReloadCause, source?: DocumentSource): Promise<WorkspaceReloadResult>;
    /** Bumped once per reload; the editor area keys its tabs on it so each re-resolves its subject. */
    getGeneration(): number;
    onReloaded(handler: (result: WorkspaceReloadResult) => void): () => void;
    /** Enrol something the participant table cannot name - today, a plugin's own store. */
    registerReloader(participant: ExternalReloadParticipant): () => void;
}

/**
 * Recovery mode's own state: which subsystems have been tried, and what they said.
 *
 * Present in every workspace so `Services.Recovery` resolves the same way everywhere, and empty in
 * all but a recovery shell - see RecoveryService for why the loading is staged rather than automatic.
 */
interface IRecoveryService extends IService {
    getProbes(): readonly import("./core/RecoveryService").RecoveryProbeState[];
    isRunning(): boolean;
    /** Never rejects: a probe's failure is its result, not an exception. */
    runProbe(id: import("./core/RecoveryService").RecoveryProbeId): Promise<void>;
    runAllProbes(): Promise<void>;
    onChanged(listener: () => void): () => void;
}

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
    IAssetService, IAudioService, IBlueprintNodeCatalogService, IBuildService, ICommandService, IDebugService, ILintService,
    IEditorService, IFileSystemService, IFontService, ILocalizationService, ILoggerService,
    IGlobalSettingsService, IPluginService, IPreviewService, IProjectService, IRuntimeService,
    IService, IServiceAssetsService, IPanelStateService, IStorageService, IStoryService,
    ITextureService, IUIService, IUuidService, IVersionControlService, IWorkspaceFreezeService,
    IWorkspaceReloadService, IVideoService,
    ICharacterService, IHistoryService, IUIDocumentService, IUIEditorHistoryService, IUIGraphService, ILocalBlueprintService, IUIBlueprintLifecycleCoordinator,
    IUIRuntimeBridgeService, IUIEditorFontFaceService, IUIEditorStateService, IDevModeService, IConsoleService, UIEditorStateEvents,
    IProjectDependencyService, IVoiceService, IVariableRegistryService, IAudioTrackService, IAppTagService,
    IBrandService,
    IDictionaryService,
    ISaveSchemaService,
    IPuppetDescriptionService,
    IMediaSupportService,
    ITestRunService, IRecoveryService,
    Services, WorkspaceContext
};

export type { ActiveSnapGuides, SmartSnapDetailSettings };
export type { StoryPluginActionCreateInput, StoryPluginActionRegistration };
