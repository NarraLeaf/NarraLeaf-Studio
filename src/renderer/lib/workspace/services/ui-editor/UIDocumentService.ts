import {
    UI_DOCUMENT_SCHEMA_VERSION,
    UIDocument,
    UISurface,
    UISurfaceKind,
    UIHost,
    UISurfaceDesignSize,
    UIElement,
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

type UIDocumentServiceEvents = {
    documentChanged: UIDocument;
    dirtyChanged: boolean;
};

const DEFAULT_SURFACE_SIZE = { width: 1280, height: 720 };

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
        throw new RendererError("UI document migration is not implemented");
    }

    private createEmptyDocument(): UIDocument {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const designSize = this.getProjectDesignSize();
        const now = new Date().toISOString();
        const documentId = uuidService.generate();
        const surfaceId = uuidService.generate();
        const rootElementId = uuidService.generate();

        const rootElement: UIElement = {
            id: rootElementId,
            type: "nl.root",
            name: "Root",
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

        const surface: UISurface = {
            id: surfaceId,
            name: "Main Surface",
            host: "app",
            kind: "appSurface",
            designSize: {
                width: designSize.width,
                height: designSize.height,
            },
            rootElementId: rootElementId,
        };

        const doc: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: documentId,
            name: "UI Document",
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

    public createSurface(kind: UISurfaceKind, name: string, host: UIHost): UISurface {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const designSize = this.getProjectDesignSize();
        const rootElementId = uuidService.generate();
        const surfaceId = uuidService.generate();

        const surface: UISurface = {
            id: surfaceId,
            name,
            host,
            kind,
            designSize,
            rootElementId,
        };

        const rootElement: UIElement = {
            id: rootElementId,
            type: "nl.root",
            name: "Root",
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

        this.mutateDocument(document => {
            document.elements[rootElementId] = rootElement;
            document.surfaces.push(surface);
        });

        return surface;
    }

    public deleteSurface(surfaceId: string): void {
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
        return projectConfig.metadata?.resolution ?? DEFAULT_SURFACE_SIZE;
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
