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
    UISlotDefinition,
    UILayout,
} from "@shared/types/ui-editor/document";
import { FsRejectErrorCode } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
import { elementTypeRegistry } from "@/lib/ui-editor/element-types/registryInstance";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { IUIDocumentService, Services, WorkspaceContext } from "../services";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import { EventEmitter } from "../ui/EventEmitter";
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

    public isDirty(): boolean {
        return this.dirty;
    }

    public getRevision(): number {
        return this.revision;
    }

    public updateElementLayout(elementId: string, layoutPatch: Partial<UILayout>): void {
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            element.layout = {
                ...element.layout,
                ...layoutPatch,
            };
        });
    }

    public updateElementLayouts(layoutPatches: Record<string, Partial<UILayout>>): void {
        const elementIds = Object.keys(layoutPatches);
        if (elementIds.length === 0) {
            return;
        }
        this.mutateDocument(document => {
            elementIds.forEach(elementId => {
                const element = document.elements[elementId];
                if (!element) {
                    return;
                }
                const patch = layoutPatches[elementId];
                element.layout = {
                    ...element.layout,
                    ...patch,
                };
            });
        });
    }

    public updateElementProps(elementId: string, propsPatch: Record<string, unknown>): void {
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            element.props = {
                ...(element.props ?? {}),
                ...propsPatch,
            };
        });
    }

    public reorderChildren(parentId: string, orderedChildIds: string[]): void {
        this.mutateDocument(document => {
            const parent = document.elements[parentId];
            if (!parent) {
                return;
            }
            parent.childrenIds = [...orderedChildIds];
        });
    }

    public deleteElements(elementIds: string[]): void {
        if (elementIds.length === 0) {
            return;
        }
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
        });
    }

    private mutateDocument(mutator: (document: UIDocument) => void): void {
        const document = this.getDocument();
        mutator(document);
        this.revision += 1;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("documentChanged", document);
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
        const definition = elementTypeRegistry.get(type);
        if (!definition) {
            throw new RendererError(`Unknown element type: ${type}`);
        }
        const document = this.getDocument();
        const parent = document.elements[parentId];
        if (!parent) {
            throw new RendererError("Parent element not found");
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
        const layout: UILayout = { ...baseLayout, ...layoutPatch };

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
        });

        return element;
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
