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
import type { LiveAudioTrackOp } from "@shared/live/ops";
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

/**
 * Somewhere a mixer edit can go instead of into the document.
 *
 * **The seam a live session hangs the mixer off, and the reason the audio section needs no
 * live-session code.** The shape is `StoryOpSink`'s and the bargain is the same: with a sink
 * installed an edit becomes an operation and the document is not touched; the tracks move when the
 * operation comes back as somebody's effect and {@link AudioTrackService.applyLiveOp} applies it.
 * Nothing is applied optimistically, so nothing ever has to be taken back.
 *
 * ⚠ **Asked from the mutators rather than from {@link AudioTrackService.applyTrackMutation},
 * which is where every edit really does converge.** That method takes a function over the whole list
 * and can only say "the tracks changed" - which is whole-document last-writer-wins, the one verb the
 * session vocabulary refuses. The mutators know what they meant, so that is where they say it. It is
 * `AssetsService.recordChanged`'s answer to the same shape of service.
 */
export type AudioTrackOpSink = {
    /**
     * Take one operation, or decline it.
     *
     * True means the sink has it and the document must not be touched. False means this edit is not
     * the sink's business and the caller carries on as usual.
     */
    handle(op: LiveAudioTrackOp): boolean;
};

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
    /** Where mixer edits go instead of into the document, when something else owns them. */
    private opSink: AudioTrackOpSink | null = null;
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
        // Appended, which is what `beforeId: null` says. The sink is asked with the record as it
        // WOULD have been written; see {@link AudioTrackOpSink}.
        if (this.opSink?.handle({ op: "create-audio-track", track, beforeId: null })) {
            return track;
        }
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
        if (this.opSink?.handle({ op: "create-audio-track", track: copy, beforeId: this.trackAfter(id) })) {
            return copy;
        }
        this.applyTrackMutation(tracks => {
            const index = tracks.findIndex(track => track.id === id);
            const next = [...tracks];
            next.splice(index < 0 ? tracks.length : index + 1, 0, copy);
            return next;
        }, audioTrackLabel("add", copy.name));
        return this.getTrack(copy.id) ?? copy;
    }

    /** The id of the bus that sits after `id` in the stored order, or null when it is the last. */
    private trackAfter(id: string): string | null {
        const tracks = this.getDocument().tracks;
        const index = tracks.findIndex(track => track.id === id);
        return index < 0 ? null : tracks[index + 1]?.id ?? null;
    }

    /**
     * Patch one track. `id` and `builtin` are not patchable: the id is what every stored reference
     * holds, and `builtin` is derived from it.
     *
     * `parentId` goes through {@link reparentTrack} instead - a patch that would make a cycle has to
     * be refused, not clamped, and this method has no way to say no.
     */
    public updateTrack(id: string, patch: Partial<Omit<ProjectAudioTrack, "id" | "builtin" | "parentId">>): void {
        if (this.stateRecord(id, track => ({ ...track, ...patch, id: track.id }))) {
            return;
        }
        this.applyTrackMutation(tracks => tracks.map(track => (
            track.id === id ? { ...track, ...patch, id: track.id } : track
        )));
    }

    /**
     * Hand the record this edit would have written to the sink, and say whether it took it.
     *
     * One place rather than two, because the operation carries the whole record and every field
     * edit therefore has the same statement to make - and a record composed a second time is a
     * record that falls behind the one the mutator writes.
     */
    private stateRecord(id: string, edit: (track: ProjectAudioTrack) => ProjectAudioTrack): boolean {
        const existing = this.getTrack(id);
        if (!this.opSink || !existing) {
            return false;
        }
        return this.opSink.handle({ op: "update-audio-track", trackId: id, track: edit({ ...existing }) });
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
        if (this.stateRecord(id, track => ({ ...track, parentId }))) {
            return true;
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
        // The promotion is DERIVED: every machine works out which buses fed this one from a mixer
        // the room already agrees on, so naming them would be a second statement of the same fact.
        if (this.opSink?.handle({ op: "delete-audio-track", trackId: id })) {
            return true;
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
        if (this.opSink?.handle({ op: "move-audio-track", trackId: id, beforeId })) {
            return;
        }
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

    /* --------------------------------------------------------------- the live-session seam */

    /** Send mixer edits somewhere else, or take them back. Null restores ordinary behaviour. */
    public setOperationSink(sink: AudioTrackOpSink | null): void {
        this.opSink = sink;
    }

    /** The tracks as they stand, or null before this window has read them. What a digest reads. */
    public tracksOrNull(): readonly ProjectAudioTrack[] | null {
        return this.document?.tracks ?? null;
    }

    /**
     * Apply one operation to the mixer, **without consulting the sink**.
     *
     * The other side of the seam: what a live session calls when an effect arrives and the tracks
     * are finally allowed to move.
     *
     * ⚠ **No undo step is pushed here.** Inside a session undo means "send the inverse of my
     * last operation", and an entry on the project stack would be a whole-document snapshot taken
     * before anybody else joined - the catastrophe the session's own undo exists to avoid.
     */
    public applyLiveOp(op: LiveAudioTrackOp): void {
        switch (op.op) {
            case "create-audio-track": {
                const reparent = new Set(op.reparent ?? []);
                this.commitTracks(tracks => {
                    const rest = tracks
                        .filter(track => track.id !== op.track.id)
                        // Undoing a deletion: the buses that were promoted out of it come home. An
                        // ordinary creation names none, so this is a no-op for it.
                        .map(track => (reparent.has(track.id) ? { ...track, parentId: op.track.id } : track));
                    const index = op.beforeId === null ? -1 : rest.findIndex(track => track.id === op.beforeId);
                    if (index < 0) {
                        return [...rest, { ...op.track }];
                    }
                    const next = [...rest];
                    next.splice(index, 0, { ...op.track });
                    return next;
                });
                return;
            }
            case "update-audio-track":
                this.commitTracks(tracks => tracks.map(track => (
                    track.id === op.trackId ? { ...op.track, id: op.trackId } : track
                )));
                return;
            case "delete-audio-track": {
                const doomed = this.getTrack(op.trackId);
                if (!doomed) {
                    // Already gone, so there is nothing to remove and nothing to promote. Not an
                    // error: the host refuses a deletion it can see is impossible, and a machine
                    // that is behind is caught by the digest rather than by a throw in an applier.
                    return;
                }
                const inheritedParent = doomed.parentId;
                this.commitTracks(tracks => tracks
                    .filter(track => track.id !== op.trackId)
                    .map(track => (track.parentId === op.trackId ? { ...track, parentId: inheritedParent } : track)));
                return;
            }
            case "move-audio-track":
                this.commitTracks(tracks => {
                    const moving = tracks.find(track => track.id === op.trackId);
                    if (!moving || op.beforeId === op.trackId) {
                        return tracks;
                    }
                    const rest = tracks.filter(track => track.id !== op.trackId);
                    const index = op.beforeId === null ? -1 : rest.findIndex(track => track.id === op.beforeId);
                    if (index < 0) {
                        return [...rest, moving];
                    }
                    rest.splice(index, 0, moving);
                    return rest;
                });
                return;
            default: {
                // A verb with no applier would otherwise be a silent no-op: the effect lands on
                // every other machine in the room and not on this one, and nothing says so until a
                // digest disagrees one message later.
                const unapplied: never = op;
                throw new RendererError(`No applier for live audio track operation: ${JSON.stringify(unapplied)}`);
            }
        }
    }

    /** {@link applyTrackMutation} without the undo step. What an effect being applied goes through. */
    private commitTracks(mutator: (tracks: ProjectAudioTrack[]) => ProjectAudioTrack[]): void {
        const document = this.getDocument();
        document.tracks = normalizeProjectAudioTracks(mutator([...document.tracks]));
        this.commitMutation();
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
