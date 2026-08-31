import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { transformPresetsSpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import { RendererError } from "@shared/utils/error";
import type { StoryTransformRef } from "@shared/types/story";
import {
    createEmptyProjectTransformPresetDocument,
    findTransformPresetByName,
    normalizeTransformPresetName,
    normalizeTransformPresets,
    normalizeTransformPresetTransform,
    TRANSFORM_PRESET_SCHEMA_VERSION,
    type ProjectTransformPreset,
    type ProjectTransformPresetDocument,
} from "@shared/types/transformPreset";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import { Service } from "../Service";
import { Services, ITransformPresetService, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { EventEmitter } from "../ui/EventEmitter";

type TransformPresetServiceEvents = {
    /** A preset was saved, renamed or removed. Carries the whole list. */
    presetsChanged: ProjectTransformPreset[];
    dirtyChanged: boolean;
};

/**
 * The project's saved transforms. Owns `editor/transform-presets.json`.
 *
 * Mirrors {@link BrandService} and {@link DictionaryService} - one project JSON, seeded from
 * absence, revision + debounced autosave, change events, and the same refuse-to-overwrite latch -
 * because it is the same class of thing: a small project-level list several surfaces read and
 * version control has to see row by row.
 *
 * It has no live-session seam, and needs none. A preset is not something two authors edit together;
 * it is a library entry one of them adds, and the surfaces that write it are clamped shut for the
 * length of a session like every other write past the story document. Nothing here is optimistic,
 * so nothing has to be taken back when a session ends.
 */
export class TransformPresetService extends Service<TransformPresetService> implements ITransformPresetService {
    private document: ProjectTransformPresetDocument | null = null;
    /**
     * Set when `editor/transform-presets.json` is on disk but could not be parsed, and never cleared
     * until a load succeeds. Everything else carries on - a project with one broken document still
     * has to open - but {@link save} refuses while it is set: the in-memory list is empty, and
     * writing that over the file would turn "unreadable" into "every preset the project had is gone".
     */
    private unreadable: DocumentCorruptError | null = null;
    private readonly events = new EventEmitter<TransformPresetServiceEvents>();
    private dirty = false;
    private revision = 0;
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.save(this.getDocument()),
        onError: err => console.warn("[TransformPresetService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, projectService, uuidService]);
        await registerAutoSaver(ctx, depend, "transformPresets", "workspace.shell.save.stores.transformPresets", this.autoSaver);

        await this.load();
    }

    public async load(): Promise<void> {
        const result = await loadDocument(transformPresetsSpec, this.storage(), transformPresetsSpec.pathFor());
        // Both cleared before the branch, not inside it: this is a singleton that re-inits on a
        // project switch, and either one carried over would be the previous project speaking for
        // this one.
        this.unreadable = null;
        this.revision = 0;

        if (result.status === "missing") {
            // NOT written on first open, for the reason the dictionary is not: the list starts
            // genuinely empty, and a file holding an empty list would appear in the first commit of
            // every project ever created to say nothing at all. It is written the first time a
            // preset is saved.
            this.document = createEmptyProjectTransformPresetDocument();
        } else if (result.status === "corrupt") {
            // Reported and survived, not thrown: this runs inside `init`, and throwing here is how
            // one unreadable document stops the whole project from opening.
            this.unreadable = result.error;
            this.document = createEmptyProjectTransformPresetDocument();
            reportUnreadableDocument(this.getContext(), result);
        } else {
            this.document = result.document;
        }

        this.setDirty(false);
        this.events.emit("presetsChanged", this.listPresets());
    }

    public async save(document: ProjectTransformPresetDocument): Promise<void> {
        if (this.unreadable) {
            throw new RendererError(
                `Refusing to write ${this.unreadable.path}: it is on disk but could not be read `
                + `(${this.unreadable.reason}), so anything written now would replace it with an empty list.`,
            );
        }
        // This write supersedes whatever the timer was going to do.
        this.autoSaver.cancel();
        const updated = this.canonical(document);
        await saveDocument(transformPresetsSpec, this.storage(), transformPresetsSpec.pathFor(), updated);
        this.document = updated;
        this.setDirty(false);
        this.events.emit("presetsChanged", this.listPresets());
    }

    public getDocument(): ProjectTransformPresetDocument {
        if (!this.document) {
            throw new RendererError("Transform presets not initialized");
        }
        return this.document;
    }

    /** Every preset, sorted by name. The array is a copy; edit through the mutators. */
    public listPresets(): ProjectTransformPreset[] {
        return this.getDocument().presets.map(preset => ({ ...preset }));
    }

    public getPreset(id: string): ProjectTransformPreset | null {
        const preset = this.getDocument().presets.find(candidate => candidate.id === id);
        return preset ? { ...preset } : null;
    }

    /**
     * Keep this transform under a name. Returns the preset, or null when there is nothing to keep -
     * a blank name, or a transform stating no channel at all.
     *
     * A name the project already holds is **overwritten**, which is how a preset is updated: an
     * author who saves "Enter from the left" a second time has adjusted it, and refusing them would
     * leave the list holding the older one under the name they just typed.
     */
    public savePreset(name: string, transform: StoryTransformRef | undefined): ProjectTransformPreset | null {
        const presetName = normalizeTransformPresetName(name);
        const presetTransform = normalizeTransformPresetTransform(transform);
        if (!presetName || !presetTransform) {
            return null;
        }
        const existing = findTransformPresetByName(this.getDocument().presets, presetName);
        const preset: ProjectTransformPreset = {
            id: existing?.id ?? this.generatePresetId(),
            name: presetName,
            transform: presetTransform,
        };
        this.applyMutation(presets => [...presets.filter(candidate => candidate.id !== preset.id), preset]);
        return preset;
    }

    /**
     * Add presets read out of an exported file. Returns how many landed.
     *
     * A name this project already holds is **kept apart rather than overwritten**, unlike
     * {@link savePreset}: saving the same name twice is an author adjusting their own preset, while
     * importing is a file from somewhere else meeting a list that was already here, and quietly
     * replacing what was here is the one outcome nobody asked for. The arriving one is numbered.
     */
    public importPresets(items: readonly { name: string; transform: StoryTransformRef }[]): number {
        const added: ProjectTransformPreset[] = [];
        for (const item of items) {
            const transform = normalizeTransformPresetTransform(item.transform);
            if (!transform) {
                continue;
            }
            const name = this.availableName(item.name, added);
            if (!name) {
                continue;
            }
            added.push({ id: this.generatePresetId([...added]), name, transform });
        }
        if (added.length === 0) {
            return 0;
        }
        this.applyMutation(presets => [...presets, ...added]);
        return added.length;
    }

    /** Rename one preset. `false` means there is no such preset, or the name is blank or taken. */
    public renamePreset(id: string, name: string): boolean {
        const existing = this.getPreset(id);
        const presetName = normalizeTransformPresetName(name);
        if (!existing || !presetName) {
            return false;
        }
        const collision = findTransformPresetByName(this.getDocument().presets, presetName);
        if (collision && collision.id !== id) {
            return false;
        }
        if (collision?.id === id && collision.name === presetName) {
            return true;
        }
        this.applyMutation(presets => presets.map(preset => (preset.id === id ? { ...preset, name: presetName } : preset)));
        return true;
    }

    /**
     * Forget a preset. `false` means the project never held it.
     *
     * Safe by construction, and worth saying once: a row written from a preset carries its own copy
     * of the channels, so nothing on any stage changes when one is deleted.
     */
    public removePreset(id: string): boolean {
        if (!this.getPreset(id)) {
            return false;
        }
        this.applyMutation(presets => presets.filter(preset => preset.id !== id));
        return true;
    }

    /** The document as it stands, or null before this window has read one. What a digest reads. */
    public documentOrNull(): ProjectTransformPresetDocument | null {
        return this.document;
    }

    /** The presets, whenever any of them move. */
    public onPresetsChanged(handler: (presets: ProjectTransformPreset[]) => void): () => void {
        return this.events.on("presetsChanged", handler);
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

    /** Write out anything the auto-save timer still owes, and wait for it. */
    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    /** The single mutation entry - mutate the list, re-normalize, then {@link bump}. */
    private applyMutation(mutator: (presets: ProjectTransformPreset[]) => ProjectTransformPreset[]): void {
        const document = this.getDocument();
        this.document = {
            ...document,
            presets: normalizeTransformPresets(mutator([...document.presets])),
        };
        this.bump();
    }

    /** Everything that follows a change, whatever made it: revision, dirty, autosave, event. */
    private bump(): void {
        this.revision += 1;
        this.setDirty(true);
        this.autoSaver.schedule();
        this.events.emit("presetsChanged", this.listPresets());
    }

    private canonical(document: ProjectTransformPresetDocument): ProjectTransformPresetDocument {
        return {
            schemaVersion: TRANSFORM_PRESET_SCHEMA_VERSION,
            presets: normalizeTransformPresets(document.presets),
        };
    }

    /**
     * A short id no preset in this project holds.
     *
     * The same shape the palette mints its colour ids in, and for the same reason: the id is written
     * into a document an author reads in a diff, and a full UUID on every row is noise. The retry is
     * bounded by the number of presets already saved.
     */
    /**
     * `name`, or `name 2` / `name 3` if the project already writes it.
     *
     * `pending` is the batch being imported, which is not in the document yet: a file holding two
     * presets called the same thing has to end with two presets, not one silently dropped.
     */
    private availableName(raw: string, pending: readonly ProjectTransformPreset[]): string | null {
        const base = normalizeTransformPresetName(raw);
        if (!base) {
            return null;
        }
        const taken = new Set([...this.getDocument().presets, ...pending].map(preset => preset.name.toLowerCase()));
        if (!taken.has(base.toLowerCase())) {
            return base;
        }
        for (let suffix = 2; ; suffix += 1) {
            const candidate = normalizeTransformPresetName(`${base} ${suffix}`);
            if (candidate && !taken.has(candidate.toLowerCase())) {
                return candidate;
            }
        }
    }

    private generatePresetId(pending: readonly ProjectTransformPreset[] = []): string {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const taken = new Set([...this.getDocument().presets, ...pending].map(preset => preset.id));

        for (let attempt = 0; ; attempt += 1) {
            const random = uuidService.generate(true).replace(/[^0-9a-z]/gi, "").toLowerCase();
            const id = `t${random.slice(0, 7)}${attempt > 0 ? attempt.toString(36) : ""}`;
            if (!taken.has(id)) {
                return id;
            }
        }
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
