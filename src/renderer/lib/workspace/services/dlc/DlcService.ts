import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { dlcSpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import { RendererError } from "@shared/utils/error";
import { APP_TAG_ID_RELEASE } from "@shared/types/appTag";
import {
    createEmptyDlcDocument,
    findDlc,
    hasDlc,
    normalizeDlcId,
    normalizeProjectDlcs,
    uniqueDlcId,
    uniqueDlcName,
    type ProjectDlc,
    type ProjectDlcDocument,
} from "@shared/types/dlc";
import type { TranslationKey } from "@shared/i18n";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { Service } from "../Service";
import { Services, IDlcService, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { HistoryService } from "../history/HistoryService";
import type { HistoryLabel } from "../history/historyModel";
import { projectHistoryScope } from "../history/historyScopes";
import { EventEmitter } from "../ui/EventEmitter";

type DlcServiceEvents = {
    dlcChanged: ProjectDlc[];
    dirtyChanged: boolean;
};

const DLC_EDIT_LABEL: HistoryLabel = { key: "project.dlc.history.edit" as TranslationKey };

function dlcLabel(key: string, name: string): HistoryLabel {
    return { key: `project.dlc.history.${key}` as TranslationKey, params: { name } };
}

/**
 * The project's DLC. Owns `editor/dlc.json`.
 *
 * Mirrors `AppTagService` down to the bookkeeping - single project JSON, migrate on load, revision +
 * debounced autosave, change events, one undo step per mutation on the project stack - because a DLC
 * is the same class of thing: a small project-level table that several surfaces reference and
 * version control has to see.
 *
 * Two rules distinguish it from the variants, and both come from the model:
 *
 * - **There is no built-in entry.** Every variant list starts with the release variant because a
 *   build is always some edition; a project ships no DLC until an author says it does, so an empty
 *   list is the honest answer and {@link resolve} returns null rather than falling back.
 * - **The id is the author's, and it is a filename.** A variant's id is generated and never shown;
 *   a DLC's is typed, displayed, and becomes `<id>_DLC.pak` beside the player's game. So it is
 *   uniquified and folded to what a filesystem will carry, and - unlike a name - it cannot be
 *   changed later without stranding every copy already in players' hands.
 *
 * **Absence is the document.** A project that ships no DLC has no file, and {@link load} does not
 * write one: opening a project must not be a change to it.
 */
export class DlcService extends Service<DlcService> implements IDlcService {
    private document: ProjectDlcDocument | null = null;
    /**
     * Set when `editor/dlc.json` is on disk but could not be parsed, and never cleared until a load
     * succeeds. Everything else carries on - a project with one broken document still has to open -
     * but {@link save} refuses while it is set: the in-memory list is empty, and writing that over
     * the file would turn "unreadable" into "the author's DLC are gone", taking with it the ids the
     * files already in players' hands are named after.
     */
    private unreadable: DocumentCorruptError | null = null;
    private readonly events = new EventEmitter<DlcServiceEvents>();
    private dirty = false;
    private revision = 0;
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.save(this.getDocument()),
        onError: err => console.warn("[DlcService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        await depend([filesystemService, projectService]);
        await registerAutoSaver(ctx, depend, "dlc", "workspace.shell.save.stores.dlc", this.autoSaver);

        await this.load();
    }

    private storage(): DocumentStorage {
        return createProjectDocumentStorage(this.getContext());
    }

    public async load(): Promise<ProjectDlc[]> {
        const result = await loadDocument(dlcSpec, this.storage(), dlcSpec.pathFor());
        // Cleared before the branch, not inside it: these services are singletons that re-init on a
        // project switch, and a latch left set by the previous project would make the next one's
        // first save refuse.
        this.unreadable = null;

        if (result.status === "corrupt") {
            // Reported and survived, not thrown: this runs inside `init`, and throwing here is how
            // one unreadable document stops the whole project from opening.
            this.unreadable = result.error;
            this.document = createEmptyDlcDocument();
            reportUnreadableDocument(this.getContext(), result);
        } else if (result.status === "missing") {
            this.document = createEmptyDlcDocument();
        } else {
            this.document = result.document;
        }

        this.revision = 0;
        this.setDirty(false);
        this.events.emit("dlcChanged", this.list());
        return this.list();
    }

    public async save(document: ProjectDlcDocument): Promise<void> {
        if (this.unreadable) {
            throw new RendererError(
                `Refusing to write ${this.unreadable.path}: it is on disk but could not be read `
                + `(${this.unreadable.reason}), so anything written now would replace it with an empty list.`,
            );
        }
        // This write supersedes whatever the timer was going to do.
        this.autoSaver.cancel();
        const updated: ProjectDlcDocument = {
            ...document,
            dlcs: normalizeProjectDlcs(document.dlcs),
            meta: {
                ...document.meta,
                updatedAt: new Date().toISOString(),
            },
        };
        await saveDocument(dlcSpec, this.storage(), dlcSpec.pathFor(), updated);
        this.document = updated;
        this.setDirty(false);
        this.events.emit("dlcChanged", this.list());
    }

    public getDocument(): ProjectDlcDocument {
        if (!this.document) {
            throw new RendererError("DLC not initialized");
        }
        return this.document;
    }

    /** Every DLC in author order. The array is a copy; edit through the mutators. */
    public list(): ProjectDlc[] {
        return [...this.getDocument().dlcs];
    }

    /** The DLC attached to one variant, in author order - what one build can be given. */
    public listForAppTag(appTagId: string | null | undefined): ProjectDlc[] {
        const tag = appTagId?.trim() || APP_TAG_ID_RELEASE;
        return this.list().filter(dlc => dlc.attachTo === tag);
    }

    /** Null for an unknown id: absent means absent, with no fallback to invent one. */
    public resolve(id: string | null | undefined): ProjectDlc | null {
        return findDlc(this.getDocument().dlcs, id);
    }

    public has(id: string | null | undefined): boolean {
        return hasDlc(this.getDocument().dlcs, id);
    }

    /** Write out anything the auto-save timer still owes, and wait for it. */
    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    public onDlcChanged(handler: (dlcs: ProjectDlc[]) => void): () => void {
        return this.events.on("dlcChanged", handler);
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
     * A new DLC, appended after the existing ones so it lands where the author is looking.
     *
     * Both the id and the name are uniquified rather than taken as given, for the reason
     * `AppTagService.createTag` gives about names, and for one more about ids: the id is the
     * filename, so two DLC sharing one would overwrite each other in the author's output folder and
     * then in the player's.
     */
    public create(input?: { id?: string; name?: string; attachTo?: string }): ProjectDlc {
        const name = uniqueDlcName(this.list().map(entry => entry.name), input?.name ?? "");
        const dlc: ProjectDlc = {
            // From the id when one was typed, otherwise from the name - which is what an author who
            // typed only a name means, and what makes the file recognisably theirs.
            id: uniqueDlcId(this.list().map(entry => entry.id), input?.id ?? name),
            name,
            attachTo: input?.attachTo?.trim() || APP_TAG_ID_RELEASE,
        };
        this.applyMutation(dlcs => [...dlcs, dlc], dlcLabel("add", dlc.name));
        return this.resolve(dlc.id) ?? dlc;
    }

    /**
     * Rename. Blank is refused rather than stored, because the normalizer would fall it back to the
     * id and put a machine name on the surface as if the author had typed it.
     *
     * A name already in use is numbered rather than refused, so the caller reads the stored name
     * back rather than assuming it got what it asked for.
     */
    public rename(id: string, name: string): boolean {
        const next = name.trim();
        if (!next || !this.resolve(id)) {
            return false;
        }
        const unique = uniqueDlcName(
            this.list().filter(entry => entry.id !== id).map(entry => entry.name),
            next,
        );
        this.applyMutation(
            dlcs => dlcs.map(dlc => (dlc.id === id ? { ...dlc, name: unique } : dlc)),
            dlcLabel("rename", unique),
        );
        return true;
    }

    /**
     * Change the id - which is to say, change the filename this DLC ships as.
     *
     * Allowed, but it is not a rename: every copy already in a player's hands keeps the old name,
     * and a story marked for the old id no longer names anything. The surface that offers it is what
     * has to say so; refusing here would instead make a typo permanent.
     *
     * Answers the id in force, which may be a numbered variation of what was asked for, or the
     * current one when nothing usable was typed.
     */
    public changeId(id: string, nextId: string): string {
        const current = this.resolve(id);
        if (!current) {
            return id;
        }
        const folded = normalizeDlcId(nextId);
        if (!folded || folded === id) {
            return id;
        }
        const unique = uniqueDlcId(this.list().filter(entry => entry.id !== id).map(entry => entry.id), folded);
        this.applyMutation(
            dlcs => dlcs.map(dlc => (dlc.id === id ? { ...dlc, id: unique } : dlc)),
            dlcLabel("rename", current.name),
        );
        return unique;
    }

    /** Which variant's builds this DLC loads into. An unknown id is refused, not stored. */
    public setAttachTo(id: string, appTagId: string): boolean {
        const next = appTagId.trim();
        const current = this.resolve(id);
        if (!next || !current) {
            return false;
        }
        this.applyMutation(
            dlcs => dlcs.map(dlc => (dlc.id === id ? { ...dlc, attachTo: next } : dlc)),
            DLC_EDIT_LABEL,
        );
        return true;
    }

    public delete(id: string): boolean {
        const current = this.resolve(id);
        if (!current) {
            return false;
        }
        this.applyMutation(dlcs => dlcs.filter(dlc => dlc.id !== id), dlcLabel("delete", current.name));
        return true;
    }

    /**
     * The single mutation entry - mutate the list, re-normalize, snapshot both sides, commit.
     *
     * The undo unit is the whole document for the reason `AppTagService` gives: it is a small table,
     * and the alternative is an inverse per mutator that each has to stay correct as the record
     * grows a key.
     */
    public applyMutation(
        mutator: (dlcs: ProjectDlc[]) => ProjectDlc[],
        label: HistoryLabel = DLC_EDIT_LABEL,
    ): void {
        const document = this.getDocument();
        const before = structuredClone(document);
        document.dlcs = normalizeProjectDlcs(mutator([...document.dlcs]));
        this.commitMutation();
        this.recordUndoStep(before, structuredClone(document), label);
    }

    /**
     * One undo step for one mutation.
     *
     * Restoring goes through {@link commitMutation} rather than through the mutators, so an undo
     * cannot be re-normalized into something other than what the author had: the snapshot already is
     * normalized. `HistoryService` suppresses recording while an undo runs, so the restore does not
     * push an entry of its own.
     */
    private recordUndoStep(
        before: ProjectDlcDocument,
        after: ProjectDlcDocument,
        label: HistoryLabel,
    ): void {
        const restore = (snapshot: ProjectDlcDocument) => {
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
        this.events.emit("dlcChanged", this.list());
    }

    private setDirty(next: boolean): void {
        if (this.dirty === next) {
            return;
        }
        this.dirty = next;
        this.events.emit("dirtyChanged", next);
    }
}
