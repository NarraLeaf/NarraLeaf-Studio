import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { variableRegistrySpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import { RendererError } from "@shared/utils/error";
import type { StoryLiteralValue, StoryVariableValueType } from "@shared/types/story/document";
import {
    type VariableRegistry,
    type VariableRegistryEntry,
    type VariableRegistryScope,
} from "@shared/types/variables/registry";
import {
    createEmptyVariableRegistry,
    listRegistryEntries,
    normalizePersistentValueType,
    seedRegistryEntriesFromBlueprintPersistent,
} from "@shared/variables/variableRegistryModel";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { Service } from "../Service";
import { Services, IVariableRegistryService, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { UuidService } from "../core/UuidService";
import { StoryService } from "../story/StoryService";
import { UIGraphService } from "../ui-editor/UIGraphService";
import { EventEmitter } from "../ui/EventEmitter";
import { migrateProjectScopedDeclarations } from "./storyDeclarationMigration";

type VariableRegistryServiceEvents = {
    registryChanged: VariableRegistry;
    dirtyChanged: boolean;
};

/**
 * Everything about a registry except when it was last written, as one comparable string.
 *
 * The document's own canonical encoder, so that two registries compare equal exactly when they would
 * produce the same file - key order included, which a hand-rolled walk over `entries` would get
 * wrong the moment a mutation reinserted a key.
 *
 * `meta` is dropped by rest, not by naming the fields to keep, so a field added to the registry later
 * is compared without anybody remembering to add it here. The one thing that must NOT be compared is
 * the timestamp this exists to decide about.
 */
function contentKey(registry: VariableRegistry): string {
    const { meta: _meta, ...content } = registry;
    return encodeCanonicalJson(content);
}

/**
 * Project-level variable registry (M-VAR). Owns `editor/variables.json`: the project-scoped variable
 * definitions - `saved` and `persistent` - authored from the variables panel. Mirrors
 * {@link UIGraphService} (single project JSON, migrate-on-load, revision + debounced autosave,
 * change events).
 *
 * The service is scope-agnostic wherever it can be: an entry's scope is set once, at creation, and
 * everything after that (rename, retype, default, description, delete) treats the two alike. Only
 * {@link createEntry} and the scoped listings need to know.
 *
 * Undo for these mutations rides the blueprint history channel: {@link LocalBlueprintService} captures
 * a registry snapshot alongside the blueprint document, so a persistent-variable edit is a single
 * Ctrl+Z in the blueprint editor. This service therefore exposes {@link replaceRegistry} for history
 * restore in addition to the CRUD helpers.
 */
export class VariableRegistryService extends Service<VariableRegistryService> implements IVariableRegistryService {
    private registry: VariableRegistry | null = null;
    /**
     * Set when `editor/variables.json` is on disk but could not be parsed, and never cleared until a
     * load succeeds. Everything else about this service carries on - a project with one broken
     * document still has to open - but {@link save} refuses outright while it is set, which is the
     * whole point: the in-memory registry is empty, and writing an empty registry over a file we
     * could not read would turn "unreadable" into "gone".
     */
    private unreadable: DocumentCorruptError | null = null;
    private readonly events = new EventEmitter<VariableRegistryServiceEvents>();
    /**
     * {@link contentKey} of what is on disk, or null when nothing has been read or written yet.
     *
     * A string rather than the registry itself because {@link applyRegistryMutation} mutates the
     * live object in place: a kept reference would compare equal to every later state of it.
     */
    private savedContentKey: string | null = null;
    private dirty = false;
    private revision = 0;
    private lastSavedRevision = 0;
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.save(this.getRegistry()),
        onError: err => console.warn("[VariableRegistryService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        const uiGraphService = ctx.services.get<UIGraphService>(Services.UIGraph);
        await depend([filesystemService, projectService, uuidService, uiGraphService]);
        await registerAutoSaver(ctx, depend, "variables", "workspace.shell.save.stores.variables", this.autoSaver);

        await this.load();
    }

    /**
     * Convert the `/save` and `/global` declaration rows of a pre-retirement project into registry
     * entries. See {@link migrateProjectScopedDeclarations} for what the pass does and why it has no
     * "already ran" flag.
     *
     * **Why here and not in a service of its own.** The pass has exactly one owner: it writes this
     * registry, its whole correctness argument is about this registry's write path (a refused save
     * must leave the rows standing), and it holds no state between runs. A dedicated service would
     * add a lifecycle for something that runs once and would then have to be ordered against both
     * this service and `StoryService` - the ordering problem `activate` exists to remove.
     *
     * **Why `activate` and not `init`.** Every service's `init` has completed by the time any
     * `activate` runs (`WorkspaceContext`), and the UI has not rendered yet. So `StoryService` is
     * guaranteed up without this service declaring a dependency on it, and no panel can read a
     * half-converted project.
     *
     * Failures are warned and swallowed: `activate` is awaited before the workspace renders, so a
     * throw here would turn "a variable did not move" into "the project will not open". Nothing was
     * recorded as done, so the next open tries again.
     */
    public async activate(ctx: WorkspaceContext): Promise<void> {
        try {
            const storyService = ctx.services.get<StoryService>(Services.Story);
            await migrateProjectScopedDeclarations(storyService, this);
        } catch (error) {
            console.warn("[VariableRegistryService] declaration migration failed", error);
        }
    }

    public async load(): Promise<VariableRegistry> {
        const result = await loadDocument(variableRegistrySpec, this.storage(), variableRegistrySpec.pathFor());
        // Cleared before the branch, not inside it. These services are singletons that re-init on a
        // project switch, and a latch left set by the previous project would make the next one's
        // first save refuse - i.e. one broken project would follow the author into every other.
        this.unreadable = null;
        // Same reasoning, and the failure it prevents is worse: two projects whose registries are
        // both empty have the same content key, so a stale one would make the seeding write below
        // decide it had nothing to do and leave the new project with no `editor/variables.json` at
        // all.
        this.savedContentKey = null;

        if (result.status === "missing") {
            // The registry is created on first open rather than lazily, so a project that predates
            // M-VAR gets its blueprint persistent variables seeded once and visibly.
            await this.save(this.createSeededRegistry());
            return this.getRegistry();
        }

        if (result.status === "corrupt") {
            // Reported and then survived, not thrown: this runs inside `init`, and throwing here is
            // how one unreadable document used to stop the whole project from opening.
            this.unreadable = result.error;
            this.registry = createEmptyVariableRegistry();
            reportUnreadableDocument(this.getContext(), result);
        } else {
            this.registry = result.document;
            // What is on disk right now, so that a save which would reproduce it writes nothing. Set
            // only here: after a corrupt read the in-memory registry is empty and stands for nothing
            // on disk, and `save` refuses outright while `unreadable` is set anyway.
            this.savedContentKey = contentKey(this.registry);
        }

        this.revision = 0;
        this.lastSavedRevision = 0;
        this.setDirty(false);
        this.events.emit("registryChanged", this.registry);
        return this.registry;
    }

    /**
     * Write the registry, **unless doing so would only move the clock.**
     *
     * The declaration migration in {@link activate} re-runs on every open of a project that still
     * holds project-scoped rows, and it re-runs by design: it has no "already done" flag, because a
     * flag on a frozen project would record itself as done having written nothing. Its second run
     * assigns the same entries the first one did, so the registry it hands here is byte-identical to
     * the one on disk - and stamping `updatedAt` regardless turned that into a real change to the
     * file, every time the project was opened, on every machine.
     *
     * ⚠ **That is not cosmetic; it is what makes two machines unable to share a project.** Both open
     * it, both rewrite `editor/variables.json` with their own clock, and the next sync is a conflict
     * on a document neither author touched - which then blocks joining a live session, because
     * joining takes a checkpoint and syncs first. Measured on real machines: timestamps 115 ms and
     * 813 ms apart, conflicting three times out of three.
     *
     * So the timestamp says when the registry last *changed*, which is what a timestamp on a
     * document is for, and a save with nothing to say leaves the file alone entirely.
     */
    public async save(registry: VariableRegistry): Promise<void> {
        if (this.unreadable) {
            throw new RendererError(
                `Refusing to write ${this.unreadable.path}: it is on disk but could not be read `
                + `(${this.unreadable.reason}), so anything written now would replace it with an empty registry.`,
            );
        }
        // This write supersedes whatever the timer was going to do.
        this.autoSaver.cancel();

        const key = contentKey(registry);
        if (key === this.savedContentKey) {
            // Nothing to write. The bookkeeping still runs: the caller asked for a save and is
            // entitled to be clean afterwards, and a dirty flag left standing here would have the
            // shell reporting unsaved work that does not exist.
            this.registry = registry;
            this.lastSavedRevision = this.revision;
            this.setDirty(false);
            this.events.emit("registryChanged", this.registry);
            return;
        }

        const updated: VariableRegistry = {
            ...registry,
            meta: {
                ...registry.meta,
                updatedAt: new Date().toISOString(),
            },
        };
        await saveDocument(variableRegistrySpec, this.storage(), variableRegistrySpec.pathFor(), updated);
        this.registry = updated;
        this.savedContentKey = key;
        this.lastSavedRevision = this.revision;
        this.setDirty(false);
        this.events.emit("registryChanged", this.registry);
    }

    public getRegistry(): VariableRegistry {
        if (!this.registry) {
            throw new RendererError("Variable registry not initialized");
        }
        return this.registry;
    }

    /** Every entry, both scopes, name-sorted. Scope-aware callers want {@link listEntriesInScope}. */
    public listEntries(): VariableRegistryEntry[] {
        return listRegistryEntries(this.getRegistry());
    }

    public listEntriesInScope(scope: VariableRegistryScope): VariableRegistryEntry[] {
        return listRegistryEntries(this.getRegistry(), scope);
    }

    public getEntry(id: string): VariableRegistryEntry | undefined {
        return this.getRegistry().entries[id];
    }

    /** Write out anything the auto-save timer still owes, and wait for it. */
    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    public onRegistryChanged(handler: (registry: VariableRegistry) => void): () => void {
        return this.events.on("registryChanged", handler);
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

    /** The single mutation entry - mutate in place, bump revision, mark dirty, schedule autosave, emit. */
    public applyRegistryMutation(mutator: (registry: VariableRegistry) => void): void {
        const registry = this.getRegistry();
        mutator(registry);
        this.revision += 1;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("registryChanged", registry);
    }

    /**
     * `scope` is required and has no default. The two scopes are backed by different stores, so a
     * default would silently decide where an author's variable lives - and the wrong answer is only
     * discovered when a save file does or does not carry it. Every caller states which it wants.
     */
    public createEntry(
        scope: VariableRegistryScope,
        input?: {
            name?: string;
            valueType?: string;
            defaultValue?: StoryLiteralValue;
            description?: string;
        },
    ): VariableRegistryEntry {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const id = uuidService.generate();
        const entry: VariableRegistryEntry = {
            id,
            storageKey: id,
            name: input?.name?.trim() || `${scope === "saved" ? "saved" : "persist"}_${id.slice(0, 8)}`,
            scope,
            valueType: normalizePersistentValueType(input?.valueType),
            // Conditional, not `defaultValue: input?.defaultValue`. A variable created without a
            // default is the ordinary case, and the assigning form puts an explicit `undefined` in
            // the record - which `JSON.stringify` dropped in silence and the canonical encoder
            // refuses by name, making every default-less variable an unsaveable registry.
            ...(input?.defaultValue !== undefined ? { defaultValue: input.defaultValue } : {}),
            ...(input?.description?.trim() ? { description: input.description.trim() } : {}),
        };
        this.applyRegistryMutation(registry => {
            registry.entries[entry.id] = entry;
        });
        return entry;
    }

    public renameEntry(id: string, name: string): void {
        this.applyRegistryMutation(registry => {
            const entry = registry.entries[id];
            if (!entry) {
                return;
            }
            const next = name.trim();
            entry.name = next.length > 0 ? next : entry.name;
        });
    }

    public setEntryValueType(id: string, valueType: StoryVariableValueType): void {
        this.applyRegistryMutation(registry => {
            const entry = registry.entries[id];
            if (!entry) {
                return;
            }
            entry.valueType = valueType;
        });
    }

    public setEntryDefault(id: string, defaultValue: StoryLiteralValue | undefined): void {
        this.applyRegistryMutation(registry => {
            const entry = registry.entries[id];
            if (!entry) {
                return;
            }
            // Clearing a default has to remove the key, the way `setEntryDescription` removes a
            // description. Assigning `undefined` leaves a property the canonical encoder rejects,
            // so the variable the author just cleared would be the one that stops the file saving.
            if (defaultValue === undefined) {
                delete entry.defaultValue;
                return;
            }
            entry.defaultValue = defaultValue;
        });
    }

    public setEntryDescription(id: string, description: string | undefined): void {
        this.applyRegistryMutation(registry => {
            const entry = registry.entries[id];
            if (!entry) {
                return;
            }
            const next = description?.trim();
            if (next) {
                entry.description = next;
            } else {
                delete entry.description;
            }
        });
    }

    public deleteEntry(id: string): void {
        this.applyRegistryMutation(registry => {
            delete registry.entries[id];
        });
    }

    /** Replace the whole registry (blueprint history restore). Sets + emits without touching history. */
    public replaceRegistry(registry: VariableRegistry): void {
        this.registry = registry;
        this.revision += 1;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("registryChanged", registry);
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

    /**
     * First-time registry for a project that predates M-VAR: seed from the blueprint document's
     * persistent variables (the field being relocated). Once the field is stripped, this seed reads
     * the stripped-and-stashed legacy entries the UIGraphService migration hands over.
     */
    private createSeededRegistry(): VariableRegistry {
        const now = new Date().toISOString();
        const uiGraphService = this.getContext().services.get<UIGraphService>(Services.UIGraph);
        const legacy = uiGraphService.consumeLegacyPersistentVariables();
        const { entries } = seedRegistryEntriesFromBlueprintPersistent(legacy ?? undefined);
        const registry = createEmptyVariableRegistry(now);
        registry.entries = entries;
        return registry;
    }

    private storage(): DocumentStorage {
        return createProjectDocumentStorage(this.getContext());
    }
}
