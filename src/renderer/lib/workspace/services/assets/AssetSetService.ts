import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { assetSetsSpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import type { TranslationKey } from "@shared/i18n";
import { RendererError } from "@shared/utils/error";
import {
    makeAssetSetAxis,
    createEmptyAssetSetDocument,
    assetSetParent,
    isLegalNesting,
    normalizeProjectAssetSets,
    uniqueAssetSetName,
    type AssetSet,
    type AssetSetAxis,
    type ProjectAssetSetDocument,
} from "@shared/types/assetSet";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import { HistoryService } from "../history/HistoryService";
import type { HistoryLabel } from "../history/historyModel";
import { projectHistoryScope } from "../history/historyScopes";
import { Service } from "../Service";
import { Services, WorkspaceContext } from "../services";
import { EventEmitter } from "../ui/EventEmitter";
import type { AssetType } from "./assetTypes";

type AssetSetServiceEvents = {
    setsChanged: AssetSet[];
    dirtyChanged: boolean;
};

const ASSET_SET_EDIT_LABEL: HistoryLabel = { key: "assets.sets.history.edit" as TranslationKey };

function assetSetLabel(key: string, name: string): HistoryLabel {
    return { key: `assets.sets.history.${key}` as TranslationKey, params: { name } };
}

/**
 * The project's asset sets. Owns `editor/asset-sets.json`.
 *
 * Mirrors `AppTagService` down to the bookkeeping - single project JSON, migrate on load, revision
 * plus debounced autosave, one undo step per mutation on the project stack - because a set is the
 * same class of thing: a small project-level table that several surfaces read and version control
 * has to see. The two differences from that service both come from the model:
 *
 * - **Nothing is synthesized.** There is no set every project has, so an empty list is an empty
 *   list, and `listSets` answering none is an ordinary state rather than a failure.
 * - **A set holds no member ids.** Everything about which files belong to one is read off the
 *   library's tags at the moment it is resolved, so importing, retagging or deleting an asset needs
 *   no write here at all. That is why this service has no dependency on `AssetsService`: it owns
 *   the declaration, and the declaration alone.
 *
 * **Absence is the document.** A project that has never declared a set has no file, and {@link load}
 * does not write one - opening a project must not be a change to it.
 *
 * The undo unit is the whole document rather than the field that changed, for the reason
 * `AppTagService` gives: it is a small table, and per-mutator inverses are inverses that each have
 * to stay correct as the record grows a key.
 */
export class AssetSetService extends Service<AssetSetService> {
    private document: ProjectAssetSetDocument | null = null;
    /**
     * Set when the document is on disk but could not be parsed, and never cleared until a load
     * succeeds. {@link save} refuses while it is set: the in-memory list is empty, and writing that
     * over the file would turn "unreadable" into "the author's sets are gone".
     */
    private unreadable: DocumentCorruptError | null = null;
    private readonly events = new EventEmitter<AssetSetServiceEvents>();
    private dirty = false;
    private revision = 0;
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.save(this.getDocument()),
        onError: err => console.warn("[AssetSetService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, projectService, uuidService]);
        await registerAutoSaver(ctx, depend, "assetSets", "workspace.shell.save.stores.assetSets", this.autoSaver);

        await this.load();
    }

    private storage(): DocumentStorage {
        return createProjectDocumentStorage(this.getContext());
    }

    public async load(): Promise<AssetSet[]> {
        const result = await loadDocument(assetSetsSpec, this.storage(), assetSetsSpec.pathFor());
        // Cleared before the branch: these services are singletons that re-init on a project switch,
        // and a latch left set by the previous project would make the next one's first save refuse.
        this.unreadable = null;

        if (result.status === "corrupt") {
            this.unreadable = result.error;
            this.document = createEmptyAssetSetDocument();
            reportUnreadableDocument(this.getContext(), result);
        } else if (result.status === "missing") {
            this.document = createEmptyAssetSetDocument();
        } else {
            this.document = result.document;
        }

        this.revision = 0;
        this.setDirty(false);
        this.events.emit("setsChanged", this.listSets());
        return this.listSets();
    }

    public async save(document: ProjectAssetSetDocument): Promise<void> {
        if (this.unreadable) {
            throw new RendererError(
                `Refusing to write ${this.unreadable.path}: it is on disk but could not be read `
                + `(${this.unreadable.reason}), so anything written now would replace it with an empty list.`,
            );
        }
        this.autoSaver.cancel();
        const updated = normalizeProjectAssetSets(document);
        await saveDocument(assetSetsSpec, this.storage(), assetSetsSpec.pathFor(), updated);
        this.document = updated;
        this.setDirty(false);
        this.events.emit("setsChanged", this.listSets());
    }

    public getDocument(): ProjectAssetSetDocument {
        if (!this.document) {
            throw new RendererError("Asset sets not initialized");
        }
        return this.document;
    }

    /** Every set in declaration order. The array is a copy; edit through the mutators. */
    public listSets(): AssetSet[] {
        return [...this.getDocument().sets];
    }

    /** Every set filed under one asset type - what a category section and a selector ask for. */
    public listSetsOfType(type: AssetType): AssetSet[] {
        return this.getDocument().sets.filter(set => set.type === type);
    }

    public getSet(id: string | null | undefined): AssetSet | undefined {
        return id ? this.getDocument().sets.find(set => set.id === id) : undefined;
    }

    public hasSet(id: string | null | undefined): boolean {
        return this.getSet(id) !== undefined;
    }

    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    public onSetsChanged(handler: (sets: AssetSet[]) => void): () => void {
        return this.events.on("setsChanged", handler);
    }

    public onDirtyChanged(handler: (dirty: boolean) => void): () => void {
        return this.events.on("dirtyChanged", handler);
    }

    public getEvents(): EventEmitter<AssetSetServiceEvents> {
        return this.events;
    }

    public isDirty(): boolean {
        return this.dirty;
    }

    public getRevision(): number {
        return this.revision;
    }

    /** The single mutation entry - mutate the list, re-normalize, bump, mark dirty, autosave, emit. */
    public applySetMutation(
        mutator: (sets: AssetSet[]) => AssetSet[],
        label: HistoryLabel = ASSET_SET_EDIT_LABEL,
    ): void {
        const document = this.getDocument();
        const before = structuredClone(document);
        // Re-normalized on every mutation rather than only on load, so nothing a caller does can put
        // a duplicate id, a blank axis key or two axes over one tag category into memory.
        this.document = normalizeProjectAssetSets({ ...document, sets: mutator([...document.sets]) });
        this.commitMutation();
        this.recordUndoStep(before, structuredClone(this.getDocument()), label);
    }

    /** Replace one set, leaving the others where they are. The shape every field edit uses. */
    public updateSet(id: string, update: (set: AssetSet) => AssetSet, label?: HistoryLabel): void {
        this.applySetMutation(
            sets => sets.map(set => (set.id === id ? update(structuredClone(set)) : set)),
            label,
        );
    }

    /**
     * A new set, appended after the existing ones so it lands where the author is looking.
     *
     * It starts with the axes the caller derived and no more. The create flow reads those off the
     * tags on the assets the author selected, which is the whole of what makes a set "smart" - but
     * that reading happens at the call site, because it is a question about the library and this
     * service owns only the declaration.
     */
    public createSet(input: {
        /** Minted by the caller when the members were tagged with it before the set existed. */
        id?: string;
        name?: string;
        type: AssetType;
        filter?: string[];
        axis?: AssetSetAxis;
        /** The folder the author made it in. Absent files it at the top of its section. */
        groupId?: string;
    }): AssetSet {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const set: AssetSet = {
            id: input.id?.trim() || uuidService.generate(),
            // Numbered rather than taken as given, for the reason `AppTagService.createTag` gives:
            // pressing Add twice must produce two names, not two rows nothing can tell apart.
            name: uniqueAssetSetName(input.name ?? "", this.takenNames(null)),
            type: input.type,
            filter: input.filter ? [...input.filter] : [],
            ...(input.groupId ? { groupId: input.groupId } : {}),
            axis: input.axis ? structuredClone(input.axis) : makeAssetSetAxis("release", []),
        };
        this.applySetMutation(sets => [...sets, set], assetSetLabel("add", set.name));
        return this.getSet(set.id) ?? set;
    }

    private takenNames(excludeId: string | null): string[] {
        return this.getDocument().sets.filter(set => set.id !== excludeId).map(set => set.name);
    }

    /**
     * Rename. Blank is refused rather than stored; a name in use is numbered rather than refused,
     * so the caller reads the stored name back rather than assuming it got what it asked for.
     *
     * Stored references hold the id, so nothing has to be rewritten.
     */
    public renameSet(id: string, name: string): boolean {
        const next = name.trim();
        const existing = this.getSet(id);
        if (!next || !existing) {
            return false;
        }
        const unique = uniqueAssetSetName(next, this.takenNames(id));
        if (unique === existing.name) {
            return true;
        }
        this.updateSet(id, set => ({ ...set, name: unique }), assetSetLabel("rename", unique));
        return true;
    }

    public deleteSet(id: string): boolean {
        const existing = this.getSet(id);
        if (!existing) {
            return false;
        }
        this.applySetMutation(sets => sets.filter(set => set.id !== id), assetSetLabel("delete", existing.name));
        return true;
    }

    /**
     * Replace a set's axes, refusing an arrangement the model has no build for.
     *
     * Refused here as well as in the editor, and this is the refusal that matters: the editor's is
     * what an author sees, and this one is what holds when a set is edited from somewhere the
     * editor's guard was never wired into. Answers false rather than throwing - the caller's job is
     * to leave the control showing what is still stored.
     *
     * See `@shared/types/assetSet` for why a build axis may not sit inside a runtime one.
     */
    public setAxis(id: string, axis: AssetSetAxis, label?: HistoryLabel): boolean {
        const set = this.getSet(id);
        if (!set) {
            return false;
        }
        // The nesting rule is checked against whatever this set hangs under, which is a reading of
        // the other sets rather than of this one - so the guard has to happen here, where the
        // document is, and not inside the record being written.
        const parent = assetSetParent({ ...set, axis }, this.listSets().filter(other => other.id !== id));
        if (parent && !isLegalNesting(parent.set.axis, axis)) {
            return false;
        }
        this.updateSet(id, current => ({ ...current, axis: structuredClone(axis) }), label);
        return true;
    }

    public setFilter(id: string, filter: string[]): boolean {
        if (!this.getSet(id)) {
            return false;
        }
        this.updateSet(id, set => ({ ...set, filter: [...filter] }));
        return true;
    }

    /**
     * Restoring goes through {@link commitMutation} rather than through the mutators, so an undo
     * cannot be re-normalized into something other than what the author had: the snapshot already is
     * normalized. `HistoryService` suppresses recording while an undo runs, so the restore does not
     * push an entry of its own.
     */
    private recordUndoStep(
        before: ProjectAssetSetDocument,
        after: ProjectAssetSetDocument,
        label: HistoryLabel,
    ): void {
        const restore = (snapshot: ProjectAssetSetDocument) => {
            this.document = structuredClone(snapshot);
            this.commitMutation();
        };
        this.getContext().services.get<HistoryService>(Services.History).pushCommand(projectHistoryScope(), {
            label,
            undo: () => restore(before),
            redo: () => restore(after),
        });
    }

    private commitMutation(): void {
        this.revision += 1;
        this.setDirty(true);
        this.autoSaver.schedule();
        this.events.emit("setsChanged", this.listSets());
    }

    private setDirty(next: boolean): void {
        if (this.dirty === next) {
            return;
        }
        this.dirty = next;
        this.events.emit("dirtyChanged", next);
    }
}
