import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { audioTracksSpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import { RendererError } from "@shared/utils/error";
import {
    BUILTIN_AUDIO_TRACKS,
    createSeededAudioTrackDocument,
    isBuiltinAudioTrackId,
    normalizeProjectAudioTracks,
    resolveAudioTrack,
    type AudioTrackChannel,
    type ProjectAudioTrack,
    type ProjectAudioTrackDocument,
} from "@shared/types/audioTrack";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { Service } from "../Service";
import { Services, IAudioTrackService, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { UuidService } from "../core/UuidService";
import { EventEmitter } from "../ui/EventEmitter";

type AudioTrackServiceEvents = {
    tracksChanged: ProjectAudioTrack[];
    dirtyChanged: boolean;
};

/**
 * The project's audio tracks. Owns `editor/audio-tracks.json`.
 *
 * Mirrors {@link VariableRegistryService} exactly - single project JSON, seed-on-missing, migrate on
 * load, revision + debounced autosave, change events - because a track is the same class of thing:
 * a small project-level table that several editors reference and version control has to see.
 *
 * The seeding rule is "absent means seed", not a migration: a project that predates tracks has no
 * document, `load` writes the three built-ins, and from then on it is an ordinary document. There is
 * nothing to migrate *from*, so there is no version bump to arrange.
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
    public applyTrackMutation(mutator: (tracks: ProjectAudioTrack[]) => ProjectAudioTrack[]): void {
        const document = this.getDocument();
        // Re-normalized on every mutation rather than only on load, so nothing a caller does can put
        // an out-of-range gain, a deleted built-in or a duplicate id into memory - the invariants the
        // resolvers rely on hold between saves, not just across them.
        document.tracks = normalizeProjectAudioTracks(mutator([...document.tracks]));
        this.revision += 1;
        this.setDirty(true);
        this.autoSaver.schedule();
        this.events.emit("tracksChanged", this.listTracks());
    }

    public createTrack(input?: Partial<Omit<ProjectAudioTrack, "id" | "builtin">>): ProjectAudioTrack {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const id = uuidService.generate();
        const track: ProjectAudioTrack = {
            id,
            name: input?.name?.trim() || `Track ${this.getDocument().tracks.length + 1}`,
            channel: input?.channel ?? "sound",
            gain: input?.gain ?? 1,
            fadeInMs: input?.fadeInMs ?? 0,
            fadeOutMs: input?.fadeOutMs ?? 0,
            loop: input?.loop ?? false,
        };
        this.applyTrackMutation(tracks => [...tracks, track]);
        return this.getTrack(id) ?? track;
    }

    /**
     * A copy of `id`, placed directly after it.
     *
     * Directly after rather than at the end because duplicating is how an author makes a variant of
     * a track they are looking at, and a copy that appears at the bottom of a long list reads as
     * nothing having happened.
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
            channel: source.channel,
            gain: source.gain,
            fadeInMs: source.fadeInMs,
            fadeOutMs: source.fadeOutMs,
            loop: source.loop,
        };
        this.applyTrackMutation(tracks => {
            const index = tracks.findIndex(track => track.id === id);
            const next = [...tracks];
            next.splice(index < 0 ? tracks.length : index + 1, 0, copy);
            return next;
        });
        return this.getTrack(copy.id) ?? copy;
    }

    /**
     * Patch one track. `id` and `builtin` are not patchable: the id is what every stored reference
     * holds, and `builtin` is derived from it.
     */
    public updateTrack(id: string, patch: Partial<Omit<ProjectAudioTrack, "id" | "builtin">>): void {
        this.applyTrackMutation(tracks => tracks.map(track => (
            track.id === id ? { ...track, ...patch, id: track.id } : track
        )));
    }

    /**
     * Delete a track. Refuses the three built-ins - they are the fallbacks every unresolvable
     * reference lands on, so there has to be one per bus at all times.
     *
     * References to a deleted track are NOT rewritten. They fall back to the built-in for their
     * channel at resolve time (see `resolveAudioTrack`), which is why the surface shows the author
     * how many there are before they press the button rather than silently repointing their work.
     */
    public deleteTrack(id: string): boolean {
        if (isBuiltinAudioTrackId(id) || !this.getTrack(id)) {
            return false;
        }
        this.applyTrackMutation(tracks => tracks.filter(track => track.id !== id));
        return true;
    }

    /** Move a custom track to sit before `beforeId`, or to the end when that is null. */
    public moveTrack(id: string, beforeId: string | null): void {
        if (isBuiltinAudioTrackId(id)) {
            return;
        }
        this.applyTrackMutation(tracks => {
            const moving = tracks.find(track => track.id === id);
            if (!moving) {
                return tracks;
            }
            const rest = tracks.filter(track => track.id !== id);
            const index = beforeId === null ? -1 : rest.findIndex(track => track.id === beforeId);
            if (index < 0) {
                return [...rest, moving];
            }
            // Never before a built-in: the normalizer would hoist the built-ins back to the front
            // anyway, and the author would see their drag land somewhere they did not aim.
            const clamped = Math.max(BUILTIN_AUDIO_TRACKS.length, index);
            rest.splice(clamped, 0, moving);
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
