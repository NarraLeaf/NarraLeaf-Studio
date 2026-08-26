import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { assetSetsSpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import type { TranslationKey } from "@shared/i18n";
import type { LiveAssetSetOp } from "@shared/live/ops";
import { RendererError } from "@shared/utils/error";
import {
    makeAssetSetAxis,
    createEmptyAssetSetDocument,
    assetSetParent,
    assetSetSubtree,
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

/**
 * Somewhere an asset set edit can go instead of into the document.
 *
 * **The seam a live session hangs the sets off, and the reason the asset panel needs no
 * live-session code beyond a freeze scope.** The shape is `StoryOpSink`'s and the bargain is the
 * same: with a sink installed an edit becomes an operation and the document is not touched; the row
 * moves when the operation comes back as somebody's effect and
 * {@link AssetSetService.applyLiveOp} applies it. Nothing is applied optimistically, so nothing
 * ever has to be taken back.
 *
 * ⚠ **Asked from the mutators rather than from {@link AssetSetService.applySetMutation}, which
 * is where every edit really does converge.** That method takes a function over the whole list and
 * can only say "the sets changed" - which is whole-document last-writer-wins, the one verb the
 * session vocabulary refuses. The mutators know what they meant, so that is where they say it. It is
 * `AssetsService.recordChanged`'s answer to the same shape of service.
 */
export type AssetSetOpSink = {
    /**
     * Take one operation, or decline it.
     *
     * True means the sink has it and the document must not be touched. False means this edit is not
     * the sink's business and the caller carries on as usual.
     */
    handle(op: LiveAssetSetOp): boolean;
};

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
    /** Where set edits go instead of into the document, when something else owns them. */
    private opSink: AssetSetOpSink | null = null;
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
        const existing = this.getSet(id);
        // The sink is asked with the record as it WOULD have been written, never with the edit that
        // produced it: an edit states an intention and every machine would resolve it against its
        // own copy. See {@link AssetSetOpSink}.
        if (existing && this.opSink?.handle({
            op: "update-asset-set",
            setId: id,
            set: update(structuredClone(existing)),
        })) {
            return;
        }
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
        // Appended, which is what `beforeId: null` says.
        if (this.opSink?.handle({ op: "create-asset-sets", creates: [{ set, beforeId: null }] })) {
            return set;
        }
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
        if (this.opSink?.handle({ op: "delete-asset-sets", setIds: [id] })) {
            return true;
        }
        this.applySetMutation(sets => sets.filter(set => set.id !== id), assetSetLabel("delete", existing.name));
        return true;
    }

    /**
     * Drop a set and the sets drawn inside it.
     *
     * What removing the row means when the files go with it: a sub-set resolves against the files
     * its parent's members are among, so leaving one behind would leave a row that promises variants
     * nothing answers.
     */
    public deleteSetSubtree(id: string): boolean {
        const existing = this.getSet(id);
        if (!existing) {
            return false;
        }
        const subtree = new Set(assetSetSubtree(existing, this.listSets()).map(set => set.id));
        // Every set the cascade takes, named rather than derived - see {@link LiveAssetSetOp} for
        // why both directions of a cascade are carried here.
        if (this.opSink?.handle({ op: "delete-asset-sets", setIds: [...subtree] })) {
            return true;
        }
        this.applySetMutation(
            sets => sets.filter(set => !subtree.has(set.id)),
            assetSetLabel("delete", existing.name),
        );
        return true;
    }

    /**
     * Drop the declaration and keep the files.
     *
     * The same edit as {@link deleteSet} and a different thing to the author, which is why it is
     * named here rather than left to the caller to label: the members carry the tags that made them
     * members, so undo brings the set back whole, and a file the set answered with is an ordinary
     * file again the moment the row is gone.
     */
    public dissolveSet(id: string): boolean {
        const existing = this.getSet(id);
        if (!existing) {
            return false;
        }
        // The same operation a deletion states, because it is the same edit to this document; the
        // two differ in what the author was told, which is the label and not the wire.
        if (this.opSink?.handle({ op: "delete-asset-sets", setIds: [id] })) {
            return true;
        }
        this.applySetMutation(sets => sets.filter(set => set.id !== id), assetSetLabel("dissolve", existing.name));
        return true;
    }

    /**
     * File a set in another folder, taking the sets nested inside it along.
     *
     * One step for the whole subtree, because a sub-set is drawn inside its parent and nowhere
     * else: moving only the row the author dragged would leave the children filed in a folder that
     * does not draw them, and they would surface there the moment the parent stopped holding them.
     *
     * Only where the row is drawn. A set holds no files, so nothing about what it resolves to
     * changes here - the panel moves the members it answers with, which is a library edit.
     */
    public moveSetToGroup(id: string, groupId?: string): boolean {
        const existing = this.getSet(id);
        if (!existing) {
            return false;
        }
        const next = groupId?.trim() || undefined;
        const moving = assetSetSubtree(existing, this.listSets());
        // Dropped back where it already is. Answered as done rather than written, so the gesture
        // does not leave an undo step that changes nothing.
        if (moving.every(set => (set.groupId ?? undefined) === next)) {
            return true;
        }
        if (this.opSink?.handle({
            op: "move-asset-sets",
            // Each entry carries its own destination, which is what lets the operation be its own
            // inverse; here they happen to share one, and undoing will not.
            moves: moving.map(set => ({ setId: set.id, groupId: next ?? null })),
        })) {
            return true;
        }
        const subtree = new Set(moving.map(set => set.id));
        this.applySetMutation(
            sets => sets.map(set => {
                if (!subtree.has(set.id)) {
                    return set;
                }
                const { groupId: _current, ...rest } = set;
                return next ? { ...rest, groupId: next } : rest;
            }),
            assetSetLabel("move", existing.name),
        );
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

    /* --------------------------------------------------------------- the live-session seam */

    /** Send set edits somewhere else, or take them back. Null restores ordinary behaviour. */
    public setOperationSink(sink: AssetSetOpSink | null): void {
        this.opSink = sink;
    }

    /** The sets as they stand, or null before this window has read them. What a digest reads. */
    public setsOrNull(): readonly AssetSet[] | null {
        return this.document?.sets ?? null;
    }

    /**
     * Apply one operation to the sets, **without consulting the sink**.
     *
     * The other side of the seam: what a live session calls when an effect arrives and the panel is
     * finally allowed to move.
     *
     * ⚠ **No undo step is pushed here**, for `AudioTrackService.applyLiveOp`'s reason: inside a
     * session undo sends the inverse of this window's own operation, and an entry on the project
     * stack would be a whole-document snapshot taken before anybody else joined.
     */
    public applyLiveOp(op: LiveAssetSetOp): void {
        switch (op.op) {
            case "create-asset-sets":
                this.commitSets(sets => {
                    const next = sets.filter(set => !op.creates.some(create => create.set.id === set.id));
                    for (const create of op.creates) {
                        const index = create.beforeId === null
                            ? -1
                            : next.findIndex(set => set.id === create.beforeId);
                        next.splice(index < 0 ? next.length : index, 0, structuredClone(create.set));
                    }
                    return next;
                });
                return;
            case "update-asset-set":
                this.commitSets(sets => sets.map(set => (
                    set.id === op.setId ? { ...structuredClone(op.set), id: op.setId } : set
                )));
                return;
            case "delete-asset-sets": {
                // Tolerant of a set that is already gone, with `delete-character-group`: the second
                // of two deletions changes nothing.
                const doomed = new Set(op.setIds);
                this.commitSets(sets => sets.filter(set => !doomed.has(set.id)));
                return;
            }
            case "move-asset-sets": {
                const moves = new Map(op.moves.map(move => [move.setId, move.groupId]));
                this.commitSets(sets => sets.map(set => {
                    if (!moves.has(set.id)) {
                        return set;
                    }
                    const groupId = moves.get(set.id) ?? null;
                    // The key is removed rather than set to undefined: the two read alike in
                    // TypeScript and are not the same document to a canonical encoder or a digest.
                    const { groupId: _current, ...rest } = set;
                    return groupId ? { ...rest, groupId } : rest;
                }));
                return;
            }
            default: {
                // A verb with no applier would otherwise be a silent no-op: the effect lands on
                // every other machine in the room and not on this one, and nothing says so until a
                // digest disagrees one message later.
                const unapplied: never = op;
                throw new RendererError(`No applier for live asset set operation: ${JSON.stringify(unapplied)}`);
            }
        }
    }

    /** {@link applySetMutation} without the undo step. What an effect being applied goes through. */
    private commitSets(mutator: (sets: AssetSet[]) => AssetSet[]): void {
        const document = this.getDocument();
        this.document = normalizeProjectAssetSets({ ...document, sets: mutator([...document.sets]) });
        this.commitMutation();
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
