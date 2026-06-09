import {
    UI_DOCUMENT_SCHEMA_VERSION,
    UIDocument,
    UISurface,
    UISurfaceId,
    UISurfaceKind,
    UIHost,
    UISurfaceDesignSize,
    UISurfaceSettings,
    UIStageSlotId,
    UIStageSurfaceMount,
    UIElement,
    UIElementId,
    UIBehaviorBinding,
    UISlotDefinition,
    UILayout,
    isUIFlowLayoutParentElement,
    uiElementTypeAcceptsChildren,
} from "@shared/types/ui-editor/document";
import { FsRejectErrorCode } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { roundUILayoutGeometryFields } from "@/lib/ui-editor/layout/roundLayoutGeometry";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { IUIDocumentService, Services, WorkspaceContext } from "../services";
import { LocalBlueprintService } from "./LocalBlueprintService";
import { UIEditorHistoryService, cloneUIHistoryDocument } from "./UIEditorHistoryService";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import { EventEmitter } from "../ui/EventEmitter";
import {
    applyPlannedMove,
    collectSubtreeElementIds,
    layoutPatchForReparent,
    planMoveElementsInSurface,
    type MoveUiElementsResult,
} from "./uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { isValidUIInsertParent } from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import type { UIEditorClipboardPayload } from "@/lib/ui-editor/commands/uiEditorClipboard";
import { cloneWidgetMainBlueprintForPaste, remapElementBehaviorBlueprintIds } from "./blueprint/cloneBlueprintForPaste";
import { registerPrivateBlueprintAsActive } from "./blueprint/ownerRecords";
import { widgetMainOwnerKey } from "./blueprint/ownerKeys";
import type { Blueprint } from "@shared/types/blueprint/document";
import {
    DEFAULT_APP_SURFACE_NAME,
    DEFAULT_UI_DOCUMENT_NAME,
    DEFAULT_UI_ROOT_NAME,
    DEFAULT_UI_SURFACE_SIZE,
    MAIN_APP_SURFACE_ID,
} from "@shared/constants/ui-editor";

type UIDocumentServiceEvents = {
    documentChanged: UIDocument;
    dirtyChanged: boolean;
};

type CreateSurfaceInput = {
    kind: UISurfaceKind;
    name: string;
    host: UIHost;
    settings?: UISurfaceSettings;
    stageMount?: UIStageSurfaceMount;
};

type UIDocumentMutationHistoryOptions =
    | {
          surfaceId: string;
          mergeKey?: string;
          mergeWindowMs?: number;
      }
    | false;

type UIDocumentMutationOptions = {
    history?: UIDocumentMutationHistoryOptions;
};

const DEFAULT_STAGE_SLOT_ID: UIStageSlotId = "dialog";

type LegacyUISurfaceKind = "appSurface" | "playerStageSurface" | "playerOverlaySurface";

type LegacyUISurface = {
    id: UISurfaceId;
    name: string;
    host: UIHost;
    kind: LegacyUISurfaceKind;
    designSize: UISurfaceDesignSize;
    rootElementId: UIElementId;
    settings?: {
        backgroundColor?: string;
        stageElementType?: UIStageSlotId;
    };
    route?: {
        id?: string;
    };
    slots?: Record<string, UISlotDefinition>;
};

type LegacyUIDocument = Omit<UIDocument, "surfaces" | "schemaVersion"> & {
    schemaVersion: 1;
    surfaces: LegacyUISurface[];
};

export class UIDocumentService extends Service<UIDocumentService> implements IUIDocumentService {
    private document: UIDocument | null = null;
    private readonly events = new EventEmitter<UIDocumentServiceEvents>();
    private revision = 0;
    private lastSavedRevision = 0;
    private dirty = false;
    private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly autoSaveDelay = 800;
    private afterMutateHook: (() => void) | null = null;
    private historySuppressionDepth = 0;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, projectService, uuidService]);

        await this.ensureDocumentDir();
        await this.load();
    }

    public getDocument(): UIDocument {
        if (!this.document) {
            throw new RendererError("UI document not initialized");
        }
        return this.document;
    }

    public async load(): Promise<UIDocument> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const documentPath = this.getDocumentPath();
        const exists = await fs.isFileExists(documentPath);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access UI document path");
        }

        if (!exists.data) {
            const created = this.createEmptyDocument();
            await this.save(created);
            this.document = created;
            return created;
        }

        const result = await fs.readJSON<UIDocument>(documentPath);
        if (!result.ok) {
            if (result.error.code === FsRejectErrorCode.NOT_FOUND) {
                const created = this.createEmptyDocument();
                await this.save(created);
                this.document = created;
                return created;
            }
            throw new RendererError(result.error.message);
        }

        const migrated = this.migrateIfNeeded(result.data);
        this.document = migrated;
        const needsSave = this.ensureMainSurface(this.document);
        if (needsSave) {
            await this.save(this.document);
            this.revision = 0;
            this.lastSavedRevision = 0;
            this.setDirty(false);
            return this.document;
        }
        this.revision = 0;
        this.lastSavedRevision = 0;
        this.setDirty(false);
        this.events.emit("documentChanged", this.document);
        return migrated;
    }

    public async save(document: UIDocument): Promise<void> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        await this.ensureDocumentDir();
        const documentPath = this.getDocumentPath();
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
        const updated: UIDocument = {
            ...document,
            meta: {
                ...document.meta,
                updatedAt: new Date().toISOString(),
            },
        };
        const data = JSON.stringify(updated, null, 2);
        const result = await fs.write(documentPath, data, "utf-8");
        if (!result.ok) {
            throw new RendererError(result.error.message);
        }
        this.document = updated;
        this.lastSavedRevision = this.revision;
        this.setDirty(false);
        this.events.emit("documentChanged", this.document);
    }

    public onDocumentChanged(handler: (doc: UIDocument) => void): () => void {
        return this.events.on("documentChanged", handler);
    }

    public onDirtyChanged(handler: (dirty: boolean) => void): () => void {
        return this.events.on("dirtyChanged", handler);
    }

    public setAfterMutateHook(hook: (() => void) | null): void {
        this.afterMutateHook = hook;
    }

    public restoreDocumentFromHistory(
        document: UIDocument,
        options: { skipAfterMutateHook?: boolean } = {},
    ): void {
        this.document = cloneUIHistoryDocument(document);
        this.revision += 1;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("documentChanged", this.document);
        if (!options.skipAfterMutateHook) {
            this.afterMutateHook?.();
        }
    }

    public runSurfaceHistoryTransaction(surfaceId: string, action: () => void): void {
        const historyService = this.getHistoryService();
        if (!historyService) {
            action();
            return;
        }
        const beforeHistory = historyService.captureSnapshot(surfaceId);
        this.historySuppressionDepth += 1;
        try {
            action();
        } finally {
            this.historySuppressionDepth -= 1;
        }
        historyService.record({
            surfaceId,
            before: beforeHistory,
            after: historyService.captureSnapshot(surfaceId),
        });
    }

    public isDirty(): boolean {
        return this.dirty;
    }

    public getRevision(): number {
        return this.revision;
    }

    public updateElementLayout(
        elementId: string,
        layoutPatch: Partial<UILayout>,
        options: { skipHistory?: boolean } = {},
    ): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            element.layout = roundUILayoutGeometryFields({
                ...element.layout,
                ...layoutPatch,
            });
        }, {
            history: !options.skipHistory && surfaceId
                ? {
                      surfaceId,
                      mergeKey: `layout:${elementId}:${Object.keys(layoutPatch).sort().join(",")}`,
                  }
                : false,
        });
    }

    public updateElementLayouts(layoutPatches: Record<string, Partial<UILayout>>): void {
        const elementIds = Object.keys(layoutPatches);
        if (elementIds.length === 0) {
            return;
        }
        const surfaceId = this.getCommonSurfaceIdForElements(elementIds);
        this.mutateDocument(document => {
            elementIds.forEach(elementId => {
                const element = document.elements[elementId];
                if (!element) {
                    return;
                }
                const patch = layoutPatches[elementId];
                element.layout = roundUILayoutGeometryFields({
                    ...element.layout,
                    ...patch,
                });
            });
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    public updateElementProps(elementId: string, propsPatch: Record<string, unknown>): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            element.props = {
                ...(element.props ?? {}),
                ...propsPatch,
            };
        }, {
            history: surfaceId
                ? {
                      surfaceId,
                      mergeKey: `props:${elementId}:${Object.keys(propsPatch).sort().join(",")}`,
                  }
                : false,
        });
    }

    public reorderChildren(parentId: string, orderedChildIds: string[]): void {
        const surfaceId = this.getElementSurfaceId(parentId);
        this.mutateDocument(document => {
            const parent = document.elements[parentId];
            if (!parent) {
                return;
            }
            parent.childrenIds = [...orderedChildIds];
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    public moveElementsInSurface(
        surfaceId: string,
        elementIds: string[],
        targetParentId: string,
        beforeChildId: string | null,
    ): MoveUiElementsResult {
        const document = this.getDocument();
        const planned = planMoveElementsInSurface(document, surfaceId, elementIds, targetParentId, beforeChildId);
        if (!planned.ok) {
            return planned;
        }
        this.mutateDocument(doc => {
            applyPlannedMove(doc, planned.plan);
        }, {
            history: { surfaceId },
        });
        return { ok: true };
    }

    public renameElement(elementId: string, name: string): void {
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const el = document.elements[elementId];
            if (!el || el.type === "nl.root") {
                return;
            }
            el.name = trimmed;
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    public deleteElements(elementIds: string[]): void {
        if (elementIds.length === 0) {
            return;
        }
        const surfaceId = this.getCommonSurfaceIdForElements(elementIds);
        this.mutateDocument(document => {
            const rootIds = new Set(document.surfaces.map(surface => surface.rootElementId));
            const toRemove = new Set<string>();

            const collect = (elementId: string) => {
                if (toRemove.has(elementId) || rootIds.has(elementId)) {
                    return;
                }
                const element = document.elements[elementId];
                if (!element) {
                    return;
                }
                toRemove.add(elementId);
                element.childrenIds.forEach(childId => collect(childId));
            };

            elementIds.forEach(id => collect(id));

            if (toRemove.size === 0) {
                return;
            }

            for (const element of Object.values(document.elements)) {
                if (element.childrenIds.length > 0) {
                    element.childrenIds = element.childrenIds.filter(childId => !toRemove.has(childId));
                }
            }

            for (const id of toRemove) {
                delete document.elements[id];
            }
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    private mutateDocument(mutator: (document: UIDocument) => void, options: UIDocumentMutationOptions = {}): void {
        const historyService = this.getHistoryService();
        const historyOptions = options.history;
        const beforeHistory =
            historyService && historyOptions && this.historySuppressionDepth === 0
                ? historyService.captureSnapshot(historyOptions.surfaceId)
                : null;
        const document = this.getDocument();
        mutator(document);
        this.revision += 1;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("documentChanged", document);
        this.afterMutateHook?.();
        if (historyService && historyOptions && beforeHistory && this.historySuppressionDepth === 0) {
            historyService.record({
                surfaceId: historyOptions.surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(historyOptions.surfaceId),
                mergeKey: historyOptions.mergeKey,
                mergeWindowMs: historyOptions.mergeWindowMs,
            });
        }
    }

    private scheduleAutoSave(): void {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = null;
            void this.save(this.getDocument()).catch(err => {
                console.warn("[UIDocumentService] auto-save failed", err);
            });
        }, this.autoSaveDelay);
    }

    private setDirty(value: boolean): void {
        if (this.dirty === value) {
            return;
        }
        this.dirty = value;
        this.events.emit("dirtyChanged", value);
    }

    private getHistoryService(): UIEditorHistoryService | null {
        try {
            return this.getContext().services.get<UIEditorHistoryService>(Services.UIEditorHistory);
        } catch {
            return null;
        }
    }

    private getElementSurfaceId(elementId: string): string | null {
        const document = this.getDocument();
        let currentId: string | null = elementId;
        while (currentId) {
            const element: UIElement | undefined = document.elements[currentId];
            if (!element) {
                return null;
            }
            if (element.parentId === null) {
                return document.surfaces.find(surface => surface.rootElementId === currentId)?.id ?? null;
            }
            currentId = element.parentId;
        }
        return null;
    }

    private getCommonSurfaceIdForElements(elementIds: string[]): string | null {
        let surfaceId: string | null = null;
        for (const elementId of elementIds) {
            const nextSurfaceId = this.getElementSurfaceId(elementId);
            if (!nextSurfaceId) {
                continue;
            }
            if (!surfaceId) {
                surfaceId = nextSurfaceId;
                continue;
            }
            if (surfaceId !== nextSurfaceId) {
                return null;
            }
        }
        return surfaceId;
    }

    private migrateIfNeeded(document: UIDocument): UIDocument {
        if (document.schemaVersion > UI_DOCUMENT_SCHEMA_VERSION) {
            throw new RendererError("UI document schema is newer than this Studio version");
        }
        if (document.schemaVersion === UI_DOCUMENT_SCHEMA_VERSION) {
            return document;
        }
        if (document.schemaVersion === 1) {
            return this.migrateFromLegacyDocument(document);
        }
        if (document.schemaVersion === 2) {
            return this.migrateFromV2Document(document);
        }
        if (document.schemaVersion === 3) {
            return this.migrateFromV3Document(document);
        }
        if (document.schemaVersion === 4) {
            return this.migrateFromV4Document(document);
        }
        throw new RendererError("UI document migration is not implemented");
    }

    private migrateFromLegacyDocument(document: UIDocument): UIDocument {
        const legacy = document as LegacyUIDocument;
        const migratedSurfaces = legacy.surfaces.map(surface => this.migrateLegacySurface(surface));
        return {
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            surfaces: migratedSurfaces,
        };
    }

    private migrateFromV2Document(document: UIDocument): UIDocument {
        return {
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        };
    }

    private migrateFromV3Document(document: UIDocument): UIDocument {
        return {
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        };
    }

    /** P5 hard cutover marker: documents authored on schema 4 (unified container model) bump to current. */
    private migrateFromV4Document(document: UIDocument): UIDocument {
        return {
            ...document,
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        };
    }

    private migrateLegacySurface(surface: LegacyUISurface): UISurface {
        const settings = surface.settings
            ? { backgroundColor: surface.settings.backgroundColor }
            : undefined;

        if (surface.kind === "appSurface") {
            return {
                id: surface.id,
                name: surface.name,
                host: "app",
                kind: "appSurface",
                designSize: surface.designSize,
                rootElementId: surface.rootElementId,
                settings,
            };
        }

        const stageMount: UIStageSurfaceMount =
            surface.kind === "playerStageSurface"
                ? {
                      kind: "slot",
                      slotId: surface.settings?.stageElementType ?? DEFAULT_STAGE_SLOT_ID,
                  }
                : { kind: "layer" };

        return {
            id: surface.id,
            name: surface.name,
            host: "player",
            kind: "stageSurface",
            designSize: surface.designSize,
            rootElementId: surface.rootElementId,
            settings,
            mount: stageMount,
            slots: surface.slots,
        };
    }

    private createEmptyDocument(): UIDocument {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const designSize = this.getProjectDesignSize();
        const now = new Date().toISOString();
        const documentId = uuidService.generate();
        const rootElementId = uuidService.generate();

        const rootElement = this.createRootElement(rootElementId, designSize);

        const surface: UISurface = {
            id: MAIN_APP_SURFACE_ID,
            name: DEFAULT_APP_SURFACE_NAME,
            host: "app",
            kind: "appSurface",
            designSize: {
                width: designSize.width,
                height: designSize.height,
            },
            rootElementId,
        };

        const doc: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: documentId,
            name: DEFAULT_UI_DOCUMENT_NAME,
            surfaces: [surface],
            elements: {
                [rootElementId]: rootElement,
            },
            meta: {
                createdAt: now,
                updatedAt: now,
            },
        };
        this.revision = 0;
        this.lastSavedRevision = 0;
        this.setDirty(false);
        this.events.emit("documentChanged", doc);
        return doc;
    }

    public createSurface(input: CreateSurfaceInput): UISurface {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const designSize = this.getProjectDesignSize();
        const rootElementId = uuidService.generate();
        const surfaceId = uuidService.generate();

        const { kind, name, host, settings, stageMount } = input;
        const effectiveMount =
            kind === "stageSurface"
                ? stageMount ?? { kind: "slot", slotId: DEFAULT_STAGE_SLOT_ID }
                : undefined;

        if (kind === "stageSurface" && host !== "player") {
            throw new RendererError("Stage surfaces must be hosted by player");
        }
        if (kind === "appSurface" && host !== "app") {
            throw new RendererError("App surfaces must be hosted by app");
        }

        const surface: UISurface =
            kind === "stageSurface"
                ? {
                      id: surfaceId,
                      name,
                      host: "player",
                      kind,
                      designSize,
                      rootElementId,
                      settings,
                      mount: effectiveMount ?? { kind: "slot", slotId: DEFAULT_STAGE_SLOT_ID },
                  }
                : {
                      id: surfaceId,
                      name,
                      host: "app",
                      kind,
                      designSize,
                      rootElementId,
                      settings,
                  };

        const rootElement = this.createRootElement(rootElementId, designSize);

        this.mutateDocument(document => {
            document.elements[rootElementId] = rootElement;
            document.surfaces.push(surface);
        });

        return surface;
    }

    public deleteSurface(surfaceId: string): void {
        if (surfaceId === MAIN_APP_SURFACE_ID) {
            return;
        }
        this.mutateDocument(document => {
            const index = document.surfaces.findIndex(surface => surface.id === surfaceId);
            if (index === -1) {
                return;
            }
            const surface = document.surfaces[index];
            document.surfaces.splice(index, 1);

            const toRemove = new Set<string>();
            const collect = (elementId: string) => {
                if (toRemove.has(elementId)) {
                    return;
                }
                const element = document.elements[elementId];
                if (!element) {
                    return;
                }
                toRemove.add(elementId);
                element.childrenIds.forEach(childId => collect(childId));
            };
            collect(surface.rootElementId);

            for (const element of Object.values(document.elements)) {
                if (element.childrenIds.length > 0) {
                    element.childrenIds = element.childrenIds.filter(childId => !toRemove.has(childId));
                }
            }

            for (const id of toRemove) {
                delete document.elements[id];
            }
        });
    }

    public updateSurface(surfaceId: string, updater: (surface: UISurface) => void): void {
        this.mutateDocument(document => {
            const surface = document.surfaces.find(next => next.id === surfaceId);
            if (!surface) {
                return;
            }
            const isMainSurface = surface.id === MAIN_APP_SURFACE_ID;
            const originalName = surface.name;
            updater(surface);
            if (isMainSurface) {
                surface.name = originalName;
                surface.id = MAIN_APP_SURFACE_ID;
            }
        });
    }

    public createElement(parentId: string, type: string, layoutPatch: Partial<UILayout> = {}): UIElement {
        const surfaceId = this.getElementSurfaceId(parentId);
        const definition = widgetModuleRegistry.get(type);
        if (!definition) {
            throw new RendererError(`Unknown element type: ${type}`);
        }
        const document = this.getDocument();
        const parent = document.elements[parentId];
        if (!parent) {
            throw new RendererError("Parent element not found");
        }
        if (!uiElementTypeAcceptsChildren(parent.type)) {
            throw new RendererError(`Parent type ${parent.type} cannot have child elements`);
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const elementId = uuidService.generate();

        const defaultElement = definition.createDefaultElement();
        const baseLayout: UILayout = {
            x: defaultElement.layout?.x ?? 0,
            y: defaultElement.layout?.y ?? 0,
            width: defaultElement.layout?.width ?? 100,
            height: defaultElement.layout?.height ?? 100,
            visible: defaultElement.layout?.visible ?? true,
            opacity: defaultElement.layout?.opacity ?? 1,
            rotation: defaultElement.layout?.rotation,
        };
        const layout: UILayout = roundUILayoutGeometryFields({ ...baseLayout, ...layoutPatch });

        const element: UIElement = {
            id: elementId,
            type: definition.type,
            name: defaultElement.name ?? definition.displayName,
            parentId,
            childrenIds: [],
            layout,
            props: defaultElement.props,
            style: defaultElement.style,
            behavior: defaultElement.behavior,
            extra: defaultElement.extra,
        };

        this.mutateDocument(documentData => {
            documentData.elements[elementId] = element;
            const parentElement = documentData.elements[parentId];
            if (parentElement) {
                parentElement.childrenIds = [...parentElement.childrenIds, elementId];
            }
        }, {
            history: surfaceId ? { surfaceId } : false,
        });

        return element;
    }

    public pasteClipboardPayload(
        surfaceId: string,
        targetParentId: string,
        beforeChildId: string | null,
        payload: UIEditorClipboardPayload,
    ): { ok: true; newRootIds: string[] } | { ok: false; reason: "invalid_clipboard" | "invalid_target" } {
        if (payload.v !== 1 || payload.topLevelElementIds.length === 0 || Object.keys(payload.elements).length === 0) {
            return { ok: false, reason: "invalid_clipboard" };
        }

        const document = this.getDocument();
        const effectiveRootId = resolveSurfaceRootElementId(document, surfaceId);
        if (!effectiveRootId) {
            return { ok: false, reason: "invalid_target" };
        }
        const allowed = collectSubtreeElementIds(document, effectiveRootId);
        const target = document.elements[targetParentId];
        if (!target || !allowed.has(targetParentId) || !isValidUIInsertParent(target)) {
            return { ok: false, reason: "invalid_target" };
        }
        if (beforeChildId != null) {
            const beforeEl = document.elements[beforeChildId];
            if (!beforeEl || beforeEl.parentId !== targetParentId) {
                return { ok: false, reason: "invalid_target" };
            }
        }

        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const historyService = this.getHistoryService();
        const beforeHistory = historyService?.captureSnapshot(surfaceId) ?? null;

        const elementIdMap: Record<string, string> = {};
        for (const oldId of Object.keys(payload.elements)) {
            elementIdMap[oldId] = uuidService.generate();
        }

        const blueprintIdMap: Record<string, string> = {};
        for (const oldBpId of Object.keys(payload.widgetMainBlueprints)) {
            blueprintIdMap[oldBpId] = uuidService.generate();
        }

        const newRootIds: string[] = [];

        this.mutateDocument(doc => {
            const parentEl = doc.elements[targetParentId];
            if (!parentEl) {
                return;
            }

            for (const oldId of Object.keys(payload.elements)) {
                const oldEl = payload.elements[oldId];
                const newId = elementIdMap[oldId];
                const isTop = payload.topLevelElementIds.includes(oldId);
                const copy = JSON.parse(JSON.stringify(oldEl)) as UIElement;
                copy.id = newId;
                if (isTop) {
                    copy.parentId = targetParentId;
                } else if (oldEl.parentId && payload.elements[oldEl.parentId]) {
                    copy.parentId = elementIdMap[oldEl.parentId];
                } else {
                    copy.parentId = null;
                }
                copy.childrenIds = oldEl.childrenIds
                    .filter(cid => payload.elements[cid])
                    .map(cid => elementIdMap[cid]);

                if (copy.behavior?.events) {
                    const remapped = remapElementBehaviorBlueprintIds(copy.behavior.events, blueprintIdMap);
                    copy.behavior = { ...copy.behavior, events: remapped };
                }

                if (isTop) {
                    const mergeLookup = (id: string) => doc.elements[id] ?? payload.elements[id];
                    const patch = layoutPatchForReparent(doc, oldEl, targetParentId, mergeLookup);
                    let layout = { ...copy.layout, ...patch };
                    const sameParentAsSource = oldEl.parentId === targetParentId;
                    if (!isUIFlowLayoutParentElement(parentEl) && sameParentAsSource) {
                        layout = {
                            ...layout,
                            x: (layout.x ?? 0) + 16,
                            y: (layout.y ?? 0) + 16,
                        };
                    }
                    copy.layout = roundUILayoutGeometryFields(layout);
                } else {
                    copy.layout = roundUILayoutGeometryFields({ ...copy.layout });
                }

                doc.elements[newId] = copy;
            }

            newRootIds.length = 0;
            for (const oldRoot of payload.topLevelElementIds) {
                const mapped = elementIdMap[oldRoot];
                if (mapped) {
                    newRootIds.push(mapped);
                }
            }

            let children = [...parentEl.childrenIds];
            children = children.filter(cid => !newRootIds.includes(cid));
            let insertAt = children.length;
            if (beforeChildId != null) {
                const idx = children.indexOf(beforeChildId);
                insertAt = idx === -1 ? children.length : idx;
            }
            children.splice(insertAt, 0, ...newRootIds);
            parentEl.childrenIds = children;
        }, { history: false });

        localBp.applyBlueprintMutation(bpDoc => {
            for (const [oldBpId, sourceBp] of Object.entries(payload.widgetMainBlueprints)) {
                const newBpId = blueprintIdMap[oldBpId];
                if (!newBpId) {
                    continue;
                }
                const owner = sourceBp.owner;
                if (owner.kind !== "widgetMain" || owner.surfaceId !== payload.sourceSurfaceId) {
                    continue;
                }
                const newElementId = elementIdMap[owner.elementId];
                if (!newElementId || !payload.elements[owner.elementId]) {
                    continue;
                }
                const cloned: Blueprint = cloneWidgetMainBlueprintForPaste({
                    source: sourceBp,
                    newBlueprintId: newBpId,
                    surfaceId,
                    newOwnerElementId: newElementId,
                    elementIdMap,
                    oldBlueprintId: oldBpId,
                    newBlueprintIdForSourceRemap: newBpId,
                });
                bpDoc.blueprints[newBpId] = cloned;
                registerPrivateBlueprintAsActive(
                    bpDoc,
                    widgetMainOwnerKey(surfaceId, newElementId),
                    newBpId,
                    cloned.frontend,
                );
            }
        });

        if (historyService && beforeHistory) {
            historyService.record({
                surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(surfaceId),
            });
        }

        return { ok: true, newRootIds };
    }

    public setElementBlueprintEvent(
        elementId: string,
        eventName: string,
        ref: { blueprintId: string; eventId: string },
    ): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        const historyService = surfaceId ? this.getHistoryService() : null;
        const beforeHistory = surfaceId && historyService ? historyService.captureSnapshot(surfaceId) : null;
        const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const bpDoc = localBp.getBlueprintDocument();
        const bp = bpDoc.blueprints[ref.blueprintId];
        const slot =
            bp?.program.kind === "graph" ? bp.program.graphs.events?.[ref.eventId] : undefined;
        const defaultLayerName = `Layer ${ref.eventId.slice(0, 8)}`;
        localBp.ensureEventGraph(
            ref.blueprintId,
            ref.eventId,
            slot ? undefined : defaultLayerName,
        );
        this.mutateDocument(document => {
            const el = document.elements[elementId];
            if (!el) {
                return;
            }
            el.behavior = el.behavior ?? {};
            el.behavior.events = el.behavior.events ?? {};
            const binding: UIBehaviorBinding = {
                kind: "blueprintEvent",
                blueprintId: ref.blueprintId,
                eventId: ref.eventId,
            };
            el.behavior.events[eventName] = binding;
        }, { history: false });
        if (surfaceId && historyService && beforeHistory) {
            historyService.record({
                surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(surfaceId),
            });
        }
    }

    public clearElementBlueprintEvent(elementId: string, eventName: string): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        const historyService = surfaceId ? this.getHistoryService() : null;
        const beforeHistory = surfaceId && historyService ? historyService.captureSnapshot(surfaceId) : null;
        const el = this.getDocument().elements[elementId];
        const cur = el?.behavior?.events?.[eventName];
        if (cur?.kind === "blueprintEvent") {
            const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
            localBp.removeEventGraph(cur.blueprintId, cur.eventId);
        }
        this.mutateDocument(document => {
            const target = document.elements[elementId];
            if (!target?.behavior?.events?.[eventName]) {
                return;
            }
            const { [eventName]: _removed, ...rest } = target.behavior.events;
            target.behavior = {
                ...target.behavior,
                events: Object.keys(rest).length > 0 ? rest : undefined,
            };
        }, { history: false });
        if (surfaceId && historyService && beforeHistory) {
            historyService.record({
                surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(surfaceId),
            });
        }
    }

    public stripBlueprintLayerBindings(surfaceId: string, blueprintId: string, layerEventId: string): void {
        this.mutateDocument(document => {
            const rootId = resolveSurfaceRootElementId(document, surfaceId);
            if (!rootId) {
                return;
            }
            const ids = collectSubtreeElementIds(document, rootId);
            for (const elId of ids) {
                const el = document.elements[elId];
                if (!el) {
                    continue;
                }
                const events = el.behavior?.events;
                if (!events) {
                    continue;
                }
                let changed = false;
                const nextEvents = { ...events };
                for (const [eventName, binding] of Object.entries(nextEvents)) {
                    if (
                        binding.kind === "blueprintEvent" &&
                        binding.blueprintId === blueprintId &&
                        binding.eventId === layerEventId
                    ) {
                        nextEvents[eventName] = { kind: "noop" };
                        changed = true;
                    }
                }
                if (changed) {
                    el.behavior = { ...el.behavior, events: nextEvents };
                }
            }
        }, { history: false });
    }

    private getProjectDesignSize(): UISurfaceDesignSize {
        const projectService = this.getContext().services.get<ProjectService>(Services.Project);
        const projectConfig = projectService.getProjectConfig();
        return projectConfig.metadata?.resolution ?? DEFAULT_UI_SURFACE_SIZE;
    }

    private createRootElement(rootElementId: UIElementId, designSize: UISurfaceDesignSize): UIElement {
        return {
            id: rootElementId,
            type: "nl.root",
            name: DEFAULT_UI_ROOT_NAME,
            parentId: null,
            childrenIds: [],
            layout: {
                x: 0,
                y: 0,
                width: designSize.width,
                height: designSize.height,
                visible: true,
                opacity: 1,
            },
        };
    }

    private ensureMainSurface(document: UIDocument): boolean {
        const designSize = this.getProjectDesignSize();
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const existingMain = document.surfaces.find(surface => surface.id === MAIN_APP_SURFACE_ID);
        let changed = false;
        if (existingMain) {
            if (existingMain.name !== DEFAULT_APP_SURFACE_NAME) {
                existingMain.name = DEFAULT_APP_SURFACE_NAME;
                changed = true;
            }
            if (!document.elements[existingMain.rootElementId]) {
                const rootElementId = uuidService.generate();
                existingMain.rootElementId = rootElementId;
                document.elements[rootElementId] = this.createRootElement(rootElementId, designSize);
                changed = true;
            }
            return changed;
        }

        const candidate = document.surfaces.find(surface => surface.kind === "appSurface");
        if (candidate) {
            candidate.id = MAIN_APP_SURFACE_ID;
            candidate.name = DEFAULT_APP_SURFACE_NAME;
            if (!document.elements[candidate.rootElementId]) {
                const rootElementId = uuidService.generate();
                candidate.rootElementId = rootElementId;
                document.elements[rootElementId] = this.createRootElement(rootElementId, designSize);
            }
            return true;
        }

        const rootElementId = uuidService.generate();
        const surface: UISurface = {
            id: MAIN_APP_SURFACE_ID,
            name: DEFAULT_APP_SURFACE_NAME,
            host: "app",
            kind: "appSurface",
            designSize: {
                width: designSize.width,
                height: designSize.height,
            },
            rootElementId,
        };

        document.elements[rootElementId] = this.createRootElement(rootElementId, designSize);
        document.surfaces.unshift(surface);
        return true;
    }

    private getDocumentPath(): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorUIDocument);
    }

    private async ensureDocumentDir(): Promise<void> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const dir = this.getContext().project.resolve(ProjectNameConvention.EditorUI);
        const exists = await fs.isDirExists(dir);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access UI document directory");
        }
        if (!exists.data) {
            const created = await fs.createDir(dir);
            if (!created.ok) {
                throw new RendererError(created.error?.message || "Failed to create UI document directory");
            }
        }
    }
}
