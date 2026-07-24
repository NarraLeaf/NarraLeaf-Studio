import { FsRejectErrorCode } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
import type { BlueprintPersistentVariable } from "@shared/types/blueprint/document";
import { type UIGraph, type UIGraphDocument, UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { ProjectNameConvention } from "../../project/nameConvention";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { createInitialBlueprintDocument, repairGlobalMainIfMissing } from "./blueprint/blueprintFactories";
import { assertValidBlueprintDocument, BlueprintDocumentValidationError } from "./blueprint/documentValidation";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { Service } from "../Service";
import { Services, IUIGraphService, WorkspaceContext } from "../services";
import { UuidService } from "../core/UuidService";
import { EventEmitter } from "../ui/EventEmitter";

type UIGraphServiceEvents = {
    graphsChanged: UIGraphDocument;
    dirtyChanged: boolean;
};

export class UIGraphService extends Service<UIGraphService> implements IUIGraphService {
    private document: UIGraphDocument | null = null;
    private readonly events = new EventEmitter<UIGraphServiceEvents>();
    private dirty = false;
    private revision = 0;
    private lastSavedRevision = 0;
    private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly autoSaveDelay = 800;
    /**
     * The persistent variables read off the raw blueprint document at load, before the migration
     * relocates them to the project-level variable registry (M-VAR). One-shot: VariableRegistryService
     * consumes this to seed `variables.json` the first time a pre-M-VAR project is opened.
     */
    private legacyPersistentVariables: Record<string, BlueprintPersistentVariable> | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, projectService, uuidService]);

        await this.ensureGraphDir();
        await this.load();
    }

    public async load(): Promise<UIGraphDocument> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const documentPath = this.getDocumentPath();
        const exists = await fs.isFileExists(documentPath);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access graph document path");
        }

        if (!exists.data) {
            const created = this.createEmptyDocument();
            await this.save(created);
            this.document = created;
            return created;
        }

        const result = await fs.readJSON<UIGraphDocument>(documentPath);
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
        this.events.emit("graphsChanged", this.document);
        return migrated;
    }

    public async save(document: UIGraphDocument): Promise<void> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        await this.ensureGraphDir();
        const documentPath = this.getDocumentPath();
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
        const updated: UIGraphDocument = {
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
        this.events.emit("graphsChanged", this.document);
    }

    public getDocument(): UIGraphDocument {
        if (!this.document) {
            throw new RendererError("Graph document not initialized");
        }
        return this.document;
    }

    public onGraphsChanged(handler: (doc: UIGraphDocument) => void): () => void {
        return this.events.on("graphsChanged", handler);
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

    /**
     * The persistent variables the last load read off the raw blueprint document, before the M-VAR
     * migration relocated them. One-shot: returns them and clears, so the registry seed runs once.
     */
    public consumeLegacyPersistentVariables(): Record<string, BlueprintPersistentVariable> | null {
        const legacy = this.legacyPersistentVariables;
        this.legacyPersistentVariables = null;
        return legacy;
    }

    public createGraph(input: {
        name?: string;
        nodes?: Record<string, UIGraph["nodes"][string]>;
        entries?: UIGraph["entries"];
        edges?: UIGraph["edges"];
        variables?: UIGraph["variables"];
        meta?: UIGraph["meta"];
    }): UIGraph {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const graphId = uuidService.generate();

        const graph: UIGraph = {
            id: graphId,
            name: input.name ?? `Graph ${graphId.slice(0, 6)}`,
            entries: input.entries ?? {},
            nodes: input.nodes ?? {},
            edges: input.edges ?? [],
            variables: input.variables,
            meta: input.meta,
        };

        this.mutateDocument(document => {
            document.graphs[graphId] = graph;
        });

        return graph;
    }

    public updateGraph(graphId: string, updater: (graph: UIGraph) => void): void {
        this.mutateDocument(document => {
            const graph = document.graphs[graphId];
            if (!graph) {
                return;
            }
            updater(graph);
        });
    }

    public deleteGraph(graphId: string): void {
        this.mutateDocument(document => {
            if (!(graphId in document.graphs)) {
                return;
            }
            delete document.graphs[graphId];
        });
    }

    /**
     * Public mutation entry for coordinated updates (e.g. LocalBlueprintService).
     */
    public applyGraphMutation(mutator: (document: UIGraphDocument) => void): void {
        this.mutateDocument(mutator);
    }

    private mutateDocument(mutator: (document: UIGraphDocument) => void): void {
        const document = this.getDocument();
        mutator(document);
        this.revision += 1;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("graphsChanged", document);
    }

    private scheduleAutoSave(): void {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = null;
            void this.save(this.getDocument()).catch(err => {
                console.warn("[UIGraphService] auto-save failed", err);
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

    private migrateIfNeeded(document: UIGraphDocument): UIGraphDocument {
        if (document.schemaVersion > UI_GRAPH_DOCUMENT_SCHEMA_VERSION) {
            throw new RendererError("Graph document schema is newer than this Studio version");
        }
        if (document.schemaVersion !== UI_GRAPH_DOCUMENT_SCHEMA_VERSION) {
            throw new RendererError(
                `uigraphs.json must use schema version ${UI_GRAPH_DOCUMENT_SCHEMA_VERSION} (Blueprint M2). Found ${String(document.schemaVersion)}.`,
            );
        }
        if (!document.blueprintDocument) {
            throw new RendererError("uigraphs.json is missing blueprintDocument (Blueprint M2 required).");
        }
        this.legacyPersistentVariables = readRawPersistentVariables(document.blueprintDocument);
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const migrated = migrateBlueprintDocumentToLatest(document.blueprintDocument);
        const repaired = repairGlobalMainIfMissing(migrated, () => uuidService.generate());
        try {
            assertValidBlueprintDocument(repaired);
        } catch (e) {
            const msg = e instanceof BlueprintDocumentValidationError ? e.message : String(e);
            throw new RendererError(`Invalid blueprintDocument: ${msg}`);
        }
        return {
            ...document,
            blueprintDocument: repaired,
        };
    }

    private createEmptyDocument(): UIGraphDocument {
        const now = new Date().toISOString();
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        return {
            schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
            graphs: {},
            blueprintDocument: createInitialBlueprintDocument(() => uuidService.generate()),
            meta: {
                createdAt: now,
                updatedAt: now,
            },
        };
    }

    private getDocumentPath(): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorUIGraphs);
    }

    private async ensureGraphDir(): Promise<void> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const dir = this.getContext().project.resolve(ProjectNameConvention.EditorUI);
        const exists = await fs.isDirExists(dir);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access UI graph directory");
        }
        if (!exists.data) {
            const created = await fs.createDir(dir);
            if (!created.ok) {
                throw new RendererError(created.error?.message || "Failed to create UI graph directory");
            }
        }
    }
}

/**
 * Read the (possibly pre-M-VAR) `persistentVariables` map off a raw blueprint document. The field is
 * no longer on the `BlueprintDocument` type - old files on disk still carry it, and the M-VAR
 * migration relocates it to the variable registry - so this reads it defensively off the raw object.
 */
function readRawPersistentVariables(blueprintDocument: unknown): Record<string, BlueprintPersistentVariable> | null {
    if (typeof blueprintDocument !== "object" || blueprintDocument === null) {
        return null;
    }
    const raw = (blueprintDocument as { persistentVariables?: unknown }).persistentVariables;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return null;
    }
    return raw as Record<string, BlueprintPersistentVariable>;
}
