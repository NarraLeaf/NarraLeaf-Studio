import { UI_DOCUMENT_SCHEMA_VERSION, UIDocument, UIElement, UISurface, UILayout } from "@shared/types/ui-editor/document";
import { FsRejectErrorCode } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
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

    private mutateDocument(mutator: (document: UIDocument) => void): void {
        const document = this.getDocument();
        mutator(document);
        this.revision += 1;
        this.setDirty(true);
        this.events.emit("documentChanged", document);
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
        const projectService = this.getContext().services.get<ProjectService>(Services.Project);
        const projectConfig = projectService.getProjectConfig();
        const designSize = projectConfig.metadata?.resolution ?? DEFAULT_SURFACE_SIZE;
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
