import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { audioTracksSpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import { RendererError } from "@shared/utils/error";
import {
    audioTrackDescendantIds,
    createSeededAudioTrackDocument,
    isBuiltinAudioTrackId,
    normalizeProjectAudioTracks,
    resolveAudioTrack,
    type AudioTrackChannel,
    type ProjectAudioTrack,
    type ProjectAudioTrackDocument,
} from "@shared/types/audioTrack";
import type { TranslationKey } from "@shared/i18n";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { Service } from "../Service";
import { Services, IAudioTrackService, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { UuidService } from "../core/UuidService";
import { HistoryService } from "../history/HistoryService";
import type { HistoryLabel } from "../history/historyModel";
import { projectHistoryScope } from "../history/historyScopes";
import { EventEmitter } from "../ui/EventEmitter";

type AudioTrackServiceEvents = {
    tracksChanged: ProjectAudioTrack[];
    dirtyChanged: boolean;
};

/**
 * What the Edit menu and the undo tooltip call one of these steps.
 *
 * Three rather than one per mutator: the two an author performs deliberately and would look for by
 * name, and one for every property edit. Naming which property changed would need a label per field
 * and would still be vague about a drag that moved a bus and reparented it in one gesture.
 */
const AUDIO_TRACK_EDIT_LABEL: HistoryLabel = { key: "project.audio.history.edit" as TranslationKey };

function audioTrackLabel(key: string, name: string): HistoryLabel {
    return { key: `project.audio.history.${key}` as TranslationKey, params: { name } };
}

/**
 * The project's audio buses. Owns `editor/audio-tracks.json`.
 *
 * Mirrors {@link VariableRegistryService} exactly - single project JSON, seed-on-missing, migrate on
 * load, revision + debounced autosave, change events - because a track is the same class of thing:
 * a small project-level table that several editors reference and version control has to see.
 *
 * The seeding rule is "absent means seed": a project that predates tracks has no document, `load`
 * writes the three seeded buses, and from then on it is an ordinary document. A v1 document (the
 * flat channel/gain/fade presets) is migrated on load by the document spec.
 *
 * Every mutation goes through {@link applyTrackMutation}, which re-normalizes: nothing a caller does
 * can leave an unknown parent, a cycle, an out-of-range volume or a missing seed in memory. The
 * mutators below then only have to worry about what they *mean*, not about what they could corrupt.
 *
 * **Every mutation is also one undo step on the project stack.** A bus is not "in" a document the
 * author has open, which is what `HistoryScopeKind.Project` is for. Deleting a track reparents its
 * children and rewrites nothing that pointed at it, so before this there was no way back from a
 * mis-click at all. The undo unit is the whole list rather than the field that changed: it is a
 * small table, and an inverse per mutator is six inverses that each have to stay correct.
 */
export class AudioTrackService extends Service<AudioTrackService> implements IAudioTrackService {
    private document: ProjectAudioTrackDocument | null = null;
    /**
     * Set when `editor/audio-tracks.json` is on disk but could not be parsed, and never cleared
     * until a load succeeds. Everything else carries on - a project with one broken document still
     * has to open - but {@link save} refuses while it is set: the in-memory list is the bare seed,
     * and writing that over the file would turn "unreadable" into "the author's tracks are gone".
     */
    private unreadable: DocumentCorruptError | null = null;
    private readonly events = new EventEmitter<AudioTrackServiceEvents>();
    private dirty = false;
    private revision = 0;
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.save(this.getDocument()),
        onError: err => console.warn("[AudioTrackService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, projectService, uuidService]);
        await registerAutoSaver(ctx, depend, "audioTracks", "workspace.shell.save.stores.audioTracks", this.autoSaver);

        await this.load();
    }

    public async load(): Promise<ProjectAudioTrack[]> {
        const result = await loadDocument(audioTracksSpec, this.storage(), audioTracksSpec.pathFor());
        // Cleared before the branch, not inside it: these services are singletons that re-init on a
        // project switch, and a latch left set by the previous project would make the next one's
        // first save refuse - one broken project following the author into every other.
        this.unreadable = null;

        if (result.status === "missing") {
            // Written on first open rather than lazily, so the document exists for version control
            // to track from the moment the project is opened, not from the first track edit.
            await this.save(createSeededAudioTrackDocument(new Date().toISOString()));
            return this.listTracks();
        }

        if (result.status === "corrupt") {
            // Reported and survived, not thrown: this runs inside `init`, and throwing here is how
            // one unreadable document stops the whole project from opening.
            this.unreadable = result.error;
            this.document = createSeededAudioTrackDocument();
            reportUnreadableDocument(this.getContext(), result);
        } else {
            this.document = result.document;
        }

        this.revision = 0;
        this.setDirty(false);
        this.events.emit("tracksChanged", this.listTracks());
        return this.listTracks();
    }

    public async save(document: ProjectAudioTrackDocument): Promise<void> {
        if (this.unreadable) {
            throw new RendererError(
                `Refusing to write ${this.unreadable.path}: it is on disk but could not be read `
                + `(${this.unreadable.reason}), so anything written now would replace it with the bare defaults.`,
            );
        }
        // This write supersedes whatever the timer was going to do.
        this.autoSaver.cancel();
        const updated: ProjectAudioTrackDocument = {
            ...document,
            tracks: normalizeProjectAudioTracks(document.tracks),
            meta: {
                ...document.meta,
                updatedAt: new Date().toISOString(),
            },
        };
        await saveDocument(audioTracksSpec, this.storage(), audioTracksSpec.pathFor(), updated);
        this.document = updated;
        this.setDirty(false);
        this.events.emit("tracksChanged", this.listTracks());
    }

    public getDocument(): ProjectAudioTrackDocument {
        if (!this.document) {
            throw new RendererError("Audio tracks not initialized");
        }
        return this.document;
    }

    /** Every track, built-ins first. The array is a copy; edit through the mutators. */
    public listTracks(): ProjectAudioTrack[] {
        return [...this.getDocument().tracks];
    }

    public getTrack(id: string): ProjectAudioTrack | undefined {
        return this.getDocument().tracks.find(track => track.id === id);
    }

    /** The one resolution entry the rest of Studio should use; see `@shared/types/audioTrack`. */
    public resolveTrack(trackId: string | null | undefined, fallbackChannel?: AudioTrackChannel): ProjectAudioTrack {
        return resolveAudioTrack(this.getDocument().tracks, trackId, fallbackChannel);
    }

    /** Write out anything the auto-save timer still owes, and wait for it. */
    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    public onTracksChanged(handler: (tracks: ProjectAudioTrack[]) => void): () => void {
        return this.events.on("tracksChanged", handler);
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

    /** The single mutation entry - mutate the list, re-normalize, bump, mark dirty, autosave, emit. */
    public applyTrackMutation(
        mutator: (tracks: ProjectAudioTrack[]) => ProjectAudioTrack[],
        label: HistoryLabel = AUDIO_TRACK_EDIT_LABEL,
    ): void {
        const document = this.getDocument();
        const before = structuredClone(document.tracks);
        // Re-normalized on every mutation rather than only on load, so nothing a caller does can put
        // an out-of-range volume, a cycle, a missing seed or a duplicate id into memory - the
        // invariants the resolvers rely on hold between saves, not just across them.
        document.tracks = normalizeProjectAudioTracks(mutator([...document.tracks]));
        this.commitMutation();
        this.recordUndoStep(before, structuredClone(document.tracks), label);
    }

    /** Bump, mark dirty, autosave, emit. Shared by a mutation and by the restore an undo performs. */
    private commitMutation(): void {
        this.revision += 1;
        this.setDirty(true);
        this.autoSaver.schedule();
        this.events.emit("tracksChanged", this.listTracks());
    }

    /**
     * One undo step for one mutation.
     *
     * The snapshot is already normalized, so restoring writes it back rather than re-running it
     * through the normalizer - an undo has to land on what the author had, not on what the rules
     * would make of it a second time. `HistoryService` suppresses recording while an undo runs.
     */
    private recordUndoStep(
        before: ProjectAudioTrack[],
        after: ProjectAudioTrack[],
        label: HistoryLabel,
    ): void {
        const restore = (snapshot: ProjectAudioTrack[]) => {
            this.getDocument().tracks = structuredClone(snapshot);
            this.commitMutation();
        };
        this.getContext().services.get<HistoryService>(Services.History).pushCommand(projectHistoryScope(), {
            label,
            undo: () => restore(before),
            redo: () => restore(after),
        });
    }

    /** A new bus, appended after its would-be siblings so it lands where the author is looking. */
    public createTrack(input?: Partial<Omit<ProjectAudioTrack, "id" | "builtin">>): ProjectAudioTrack {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const id = uuidService.generate();
        const parentId = input?.parentId ?? null;
        const track: ProjectAudioTrack = {
            id,
            name: input?.name?.trim() || `Track ${this.getDocument().tracks.length + 1}`,
            // An unknown parent would be silently re-rooted by the normalizer; refusing it here
            // instead would only turn a caller's typo into an exception, so root is the answer.
            parentId: parentId !== null && this.getTrack(parentId) ? parentId : null,
            volume: input?.volume ?? 1,
            loop: input?.loop ?? false,
        };
        this.applyTrackMutation(tracks => [...tracks, track], audioTrackLabel("add", track.name));
        return this.getTrack(id) ?? track;
    }

    /**
     * A copy of `id`, placed directly after it and under the same parent.
     *
     * Directly after rather than at the end because duplicating is how an author makes a variant of
     * a track they are looking at, and a copy that appears at the bottom of a long list reads as
     * nothing having happened. The copy is one bus, not a subtree: the children stay on the
     * original, because "duplicate this strip" and "clone this whole submix" are different asks and
     * the destructive-looking one should not be the one that happens by default.
     */
    public duplicateTrack(id: string): ProjectAudioTrack | null {
        const source = this.getTrack(id);
        if (!source) {
            return null;
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const copy: ProjectAudioTrack = {
            id: uuidService.generate(),
            name: `${source.name} 2`,
            parentId: source.parentId,
            volume: source.volume,
            loop: source.loop,
        };
        this.applyTrackMutation(tracks => {
            const index = tracks.findIndex(track => track.id === id);
            const next = [...tracks];
            next.splice(index < 0 ? tracks.length : index + 1, 0, copy);
            return next;
        }, audioTrackLabel("add", copy.name));
        return this.getTrack(copy.id) ?? copy;
    }

    /**
     * Patch one track. `id` and `builtin` are not patchable: the id is what every stored reference
     * holds, and `builtin` is derived from it.
     *
     * `parentId` goes through {@link reparentTrack} instead - a patch that would make a cycle has to
     * be refused, not clamped, and this method has no way to say no.
     */
    public updateTrack(id: string, patch: Partial<Omit<ProjectAudioTrack, "id" | "builtin" | "parentId">>): void {
        this.applyTrackMutation(tracks => tracks.map(track => (
            track.id === id ? { ...track, ...patch, id: track.id } : track
        )));
    }

    /** Rename. Blank is refused rather than stored, because the normalizer would fall it back to the id. */
    public renameTrack(id: string, name: string): boolean {
        const next = name.trim();
        if (!next || !this.getTrack(id)) {
            return false;
        }
        this.updateTrack(id, { name: next });
        return true;
    }

    /**
     * Whether `id` may hang off `parentId`.
     *
     * False for an unknown track, for itself, and for any of its own descendants. The surface asks
     * this to build the parent list rather than offering a choice it would then have to undo: a
     * select that lets the author pick a cycle and silently re-roots the track afterwards teaches
     * them that the control is broken.
     */
    public canReparentTrack(id: string, parentId: string | null): boolean {
        if (!this.getTrack(id)) {
            return false;
        }
        if (parentId === null) {
            return true;
        }
        if (parentId === id || !this.getTrack(parentId)) {
            return false;
        }
        return !audioTrackDescendantIds(this.getDocument().tracks, id).has(parentId);
    }

    /** Route `id` into another bus, or straight to master with `null`. Refuses anything cyclic. */
    public reparentTrack(id: string, parentId: string | null): boolean {
        if (!this.canReparentTrack(id, parentId)) {
            return false;
        }
        this.applyTrackMutation(tracks => tracks.map(track => (
            track.id === id ? { ...track, parentId } : track
        )));
        return true;
    }

    /**
     * Delete a track. Refuses the three seeded buses - they are where every unresolvable reference
     * lands and what the player's volume preferences alias onto, so they exist at all times.
     *
     * **Children are promoted, never deleted.** They move to the deleted track's own parent, which
     * is the only non-destructive answer available: a cascade would take out an arbitrary amount of
     * the author's mixer behind one confirm and silently strand every reference in the subtree,
     * while refusing outright would make the author hand-move each child first to do a thing the
     * app could have done for them. Promotion loses exactly one multiplication stage, and it is
     * visible - the children are now where their parent was.
     *
     * References to the deleted track itself are NOT rewritten. They fall back to the seeded bus for
     * their shape at resolve time (see `resolveAudioTrack`), which is why the surface tells the
     * author how many there are before they press the button rather than silently repointing them.
     */
    public deleteTrack(id: string): boolean {
        const doomed = this.getTrack(id);
        if (isBuiltinAudioTrackId(id) || !doomed) {
            return false;
        }
        const inheritedParent = doomed.parentId;
        this.applyTrackMutation(
            tracks => tracks
                .filter(track => track.id !== id)
                .map(track => (track.parentId === id ? { ...track, parentId: inheritedParent } : track)),
            audioTrackLabel("delete", doomed.name),
        );
        return true;
    }

    /**
     * Move a track to sit before `beforeId` in the stored order, or last when that is null.
     *
     * Order is sibling order on the surface; the tree itself is rebuilt from `parentId`, so this
     * never changes what feeds into what. Any track can move, seeded ones included - there is no
     * longer a block of built-ins at the front to protect.
     */
    public moveTrack(id: string, beforeId: string | null): void {
        this.applyTrackMutation(tracks => {
            const moving = tracks.find(track => track.id === id);
            if (!moving || beforeId === id) {
                return tracks;
            }
            const rest = tracks.filter(track => track.id !== id);
            const index = beforeId === null ? -1 : rest.findIndex(track => track.id === beforeId);
            if (index < 0) {
                return [...rest, moving];
            }
            rest.splice(index, 0, moving);
            return rest;
        });
    }

    private setDirty(value: boolean): void {
        if (this.dirty === value) {
            return;
        }
        this.dirty = value;
        this.events.emit("dirtyChanged", value);
    }

    private storage(): DocumentStorage {
        return createProjectDocumentStorage(this.getContext());
    }
}
