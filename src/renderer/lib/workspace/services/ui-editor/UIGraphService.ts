import { FsRejectErrorCode } from "@shared/types/os";
import type { LiveUIGraphOp } from "@shared/live/ops";
import {
    applyUIGraphParts,
    diffUIGraphParts,
    uiGraphPartsUpdates,
    type LiveUIGraphParts,
} from "@shared/live/uiGraphParts";
import { RendererError } from "@shared/utils/error";
import { type UIGraph, type UIGraphDocument, UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { ProjectNameConvention } from "../../project/nameConvention";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { createInitialBlueprintDocument, repairGlobalMainIfMissing } from "./blueprint/blueprintFactories";
import { assertValidBlueprintDocument, BlueprintDocumentValidationError } from "./blueprint/documentValidation";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { Service } from "../Service";
import { Services, IUIGraphService, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver } from "../autosave/SaveStatusService";
import { UuidService } from "../core/UuidService";
import { EventEmitter } from "../ui/EventEmitter";

type UIGraphServiceEvents = {
    graphsChanged: UIGraphDocument;
    dirtyChanged: boolean;
};

/**
 * Somewhere for a blueprint edit to go instead of into the document.
 *
 * `UIOpSink`'s shape one file along, hanging on the same kind of seam and for the same reason: every
 * canvas gesture reaches this document through an opaque updater, so the finest thing that can be
 * stated at the one door they all pass through is which records changed. See
 * `@shared/live/uiGraphParts`.
 */
export type UIGraphOpSink = {
    /** Take one operation, or decline it. True means the document must not be touched. */
    handle(op: LiveUIGraphOp): boolean;
};

export class UIGraphService extends Service<UIGraphService> implements IUIGraphService {
    private document: UIGraphDocument | null = null;
    private readonly events = new EventEmitter<UIGraphServiceEvents>();
    /** Where edits go instead of into the document, when something else owns them. */
    private opSink: UIGraphOpSink | null = null;
    /** How deep inside {@link holdDerived} this is, so that reconciliation never becomes a message. */
    private derivedDepth = 0;
    private dirty = false;
    private revision = 0;
    private lastSavedRevision = 0;
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.save(this.getDocument()),
        onError: err => console.warn("[UIGraphService] auto-save failed", err),
    });
    /**
     * The persistent variables read off the raw blueprint document at load, before the migration
     * relocates them to the project-level variable registry (M-VAR). One-shot: VariableRegistryService
     * consumes this to seed `variables.json` the first time a pre-M-VAR project is opened.
     */

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, projectService, uuidService]);
        await registerAutoSaver(ctx, depend, "uiGraph", "workspace.shell.save.stores.uiGraph", this.autoSaver);

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
        // This write supersedes whatever the timer was going to do.
        this.autoSaver.cancel();
        const updated: UIGraphDocument = {
            ...document,
            meta: {
                ...document.meta,
                updatedAt: new Date().toISOString(),
            },
        };
        const data = JSON.stringify(updated, null, 2);
        // Not `fs.write`: see the note on `UIDocumentService.writeDocumentFile`. `uigraphs.json` has
        // the same shape - created on the first open of a project that predates it, replaced on
        // every auto-save after - and the same stricter rejection contract now applies to it.
        const result = await fs.writeFileNoFollowOrCreate(documentPath, data, "utf-8");
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

    /** Write out anything the auto-save timer still owes, and wait for it. */
    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
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

    /** Send blueprint edits somewhere else, or take them back. Null restores ordinary behaviour. */
    public setOperationSink(sink: UIGraphOpSink | null): void {
        this.opSink = sink;
    }

    /**
     * Apply one operation to the document, **without consulting the sink**.
     *
     * The other side of the seam. It goes through the same `mutateDocument` a gesture does, so an
     * arrival and a local edit change the document in exactly one way and the dirty marking, the
     * auto-save and `graphsChanged` all still happen.
     */
    public applyLiveOp(op: LiveUIGraphOp): void {
        switch (op.op) {
            case "write-ui-graphs": {
                // A copy, because the records arrived inside a message the sender may still be
                // holding - the host keeps every effect it broadcast - and applying writes them
                // into the document, which then edits them in place.
                const copy = JSON.parse(JSON.stringify(op.parts)) as LiveUIGraphParts;
                this.mutateDocument(document => applyUIGraphParts(document, copy), { live: true });
                return;
            }
            default: {
                // Exhaustive over the vocabulary; see `UIDocumentService.applyLiveOp` for why a
                // missing applier would be a silent no-op rather than an error.
                const unapplied: never = op.op;
                throw new RendererError(`No applier for live blueprint operation: ${String(unapplied)}`);
            }
        }
    }

    /**
     * Run derived blueprint work with the sink standing aside, and answer what it wrote.
     *
     * **What this exists for is the one seam between the two interface documents.** Adding a widget
     * to a Surface writes `uidoc.json` and then reconciles a private blueprint for it in
     * `uigraphs.json` (`UIBlueprintLifecycleCoordinator`), in the same synchronous step. That second
     * write is DERIVED - every machine computes the same records from the same interface effect,
     * which is why the blueprint ids it mints are derived from the owner key rather than freshly
     * minted (see `LocalBlueprintService.ensureWidgetMain`). So it must not become an operation of
     * its own: on the host that would be a second message per gesture and a second press of undo, and
     * on a guest it would be an intent for work nobody asked for.
     *
     * ⚠ **Derived does not mean unchecked.** What comes back is handed to the effect's digests, so a
     * machine that reconciled differently is caught by the message that caused it rather than by
     * some later one - the rule every piece of derived work in this design follows.
     */
    public holdDerived(run: () => void): LiveUIGraphParts | null {
        if (!this.opSink) {
            run();
            return null;
        }
        const before = JSON.parse(JSON.stringify(this.getDocument())) as UIGraphDocument;
        const revision = this.revision;
        this.derivedDepth += 1;
        try {
            run();
        } finally {
            this.derivedDepth -= 1;
        }
        if (this.revision === revision) {
            // Nothing wrote, which is the ordinary case: the reconciliation is a no-op whenever the
            // owner records already match. Skipping the comparison here is what keeps the cost of
            // nudging one element off the whole blueprint document.
            return null;
        }
        return diffUIGraphParts(before, this.getDocument());
    }

    private mutateDocument(mutator: (document: UIGraphDocument) => void, options: { live?: boolean } = {}): void {
        if (this.opSink && !options.live && this.derivedDepth === 0) {
            // Run the gesture against a copy and state what it did, rather than doing it. See
            // {@link UIGraphOpSink}.
            const current = this.getDocument();
            const draft = JSON.parse(JSON.stringify(current)) as UIGraphDocument;
            mutator(draft);
            const parts = diffUIGraphParts(current, draft);
            if (parts === null) {
                // A mutation that changed nothing must not become a message. This document gets a
                // great many of them: the three `ensure*` helpers run after every interface edit and
                // are almost always no-ops.
                return;
            }
            // Which blueprints were already here, for the interface delta's reason: a graph edit
            // landing on a blueprint somebody deleted would put the whole blueprint back rather
            // than the one node.
            const updates = uiGraphPartsUpdates(current, parts);
            if (this.opSink.handle({ op: "write-ui-graphs", parts, ...(updates.length === 0 ? {} : { updates }) })) {
                return;
            }
        }
        const document = this.getDocument();
        mutator(document);
        this.revision += 1;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("graphsChanged", document);
    }

    private scheduleAutoSave(): void {
        this.autoSaver.schedule();
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
