import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { variableRegistrySpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import type { LiveVariableOp } from "@shared/live/ops";
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
 * Somewhere a registry edit can go instead of into the registry.
 *
 * **The seam a live session hangs the variable registry off, and the reason the variables panel needs
 * no live-session code.** The shape is `StoryOpSink`'s and `LocalizationOpSink`'s, and the bargain is
 * the same: with a sink installed an edit becomes an operation and the document is not touched; the
 * row moves when the operation comes back as somebody's effect and {@link
 * VariableRegistryService.applyLiveOp} applies it. Nothing is applied optimistically, so nothing ever
 * has to be taken back.
 *
 * ⚠ **What it is handed is the entry as it WOULD have been written, never the field that changed.**
 * A patch states an intention and every receiving machine would have to resolve it against its own
 * copy - and the panel's own retype gesture rewrites the value type and the default together, so a
 * field-level statement would carry half of one act.
 */
export type VariableOpSink = {
    /**
     * Take one operation, or decline it.
     *
     * True means the sink has it and the registry must not be touched. False means this edit is not
     * the sink's business and the caller carries on as usual.
     */
    handle(op: LiveVariableOp): boolean;
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
    /** Where registry edits go instead of into the registry, when something else owns them. */
    private opSink: VariableOpSink | null = null;
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
        if (this.opSink?.handle({ op: "create-variable", entry })) {
            // ⚠ The entry is returned but is NOT in the registry: it arrives when the effect does.
            // A caller that goes on to edit what it was handed - `createEntry(...)` then a setter -
            // would be writing to an object nobody holds, exactly as creating a character inside a
            // session is. Every caller here states the whole entry up front for that reason.
            return entry;
        }
        this.applyRegistryMutation(registry => {
            registry.entries[entry.id] = entry;
        });
        return entry;
    }

    public renameEntry(id: string, name: string): void {
        const entry = this.getEntry(id);
        const next = name.trim();
        // Nothing is stated for a name the registry is about to refuse: an emptied box leaves the
        // entry exactly as it was, and an operation saying so would be an effect for a change nobody
        // made. The fall-through still emits, which is what re-renders the controlled input.
        if (entry && next.length > 0 && this.stated({ ...entry, name: next })) {
            return;
        }
        this.applyRegistryMutation(registry => {
            const target = registry.entries[id];
            if (!target) {
                return;
            }
            target.name = next.length > 0 ? next : target.name;
        });
    }

    /**
     * Retype a variable, and give it the starting value that type calls for.
     *
     * ⚠ **Both fields in ONE call, and that is not a convenience.** Retyping is one gesture in the
     * panel and the two fields hold each other up - a boolean's default is `false`, a number's is 0 -
     * so stating them apart is stating half an act twice. Inside a live session the two halves would
     * be two operations, and the second is built from a document the first has not been allowed to
     * change: it would carry the OLD value type and undo the retype on every machine in the room.
     * Outside one it merely cost the author two presses of undo for one decision.
     *
     * `defaultValue` omitted leaves the default alone, which is what a caller that is only changing
     * the type means.
     */
    public setEntryValueType(
        id: string,
        valueType: StoryVariableValueType,
        defaultValue?: StoryLiteralValue,
    ): void {
        const entry = this.getEntry(id);
        if (entry) {
            const next: VariableRegistryEntry = defaultValue === undefined
                ? { ...entry, valueType }
                : { ...entry, valueType, defaultValue };
            if (this.stated(next)) {
                return;
            }
        }
        this.applyRegistryMutation(registry => {
            const target = registry.entries[id];
            if (!target) {
                return;
            }
            target.valueType = valueType;
            if (defaultValue !== undefined) {
                target.defaultValue = defaultValue;
            }
        });
    }

    public setEntryDefault(id: string, defaultValue: StoryLiteralValue | undefined): void {
        const entry = this.getEntry(id);
        if (entry) {
            // Built the way the mutation below writes it: clearing removes the key rather than
            // assigning `undefined`, which the canonical encoder refuses by name - and an operation
            // carrying such a property would be an entry no receiving machine could save.
            const { defaultValue: _cleared, ...rest } = entry;
            const next: VariableRegistryEntry = defaultValue === undefined
                ? rest
                : { ...entry, defaultValue };
            if (this.stated(next)) {
                return;
            }
        }
        this.applyRegistryMutation(registry => {
            const target = registry.entries[id];
            if (!target) {
                return;
            }
            // Clearing a default has to remove the key, the way `setEntryDescription` removes a
            // description. Assigning `undefined` leaves a property the canonical encoder rejects,
            // so the variable the author just cleared would be the one that stops the file saving.
            if (defaultValue === undefined) {
                delete target.defaultValue;
                return;
            }
            target.defaultValue = defaultValue;
        });
    }

    public setEntryDescription(id: string, description: string | undefined): void {
        const entry = this.getEntry(id);
        if (entry) {
            const trimmed = description?.trim();
            const { description: _cleared, ...rest } = entry;
            const next: VariableRegistryEntry = trimmed ? { ...entry, description: trimmed } : rest;
            if (this.stated(next)) {
                return;
            }
        }
        this.applyRegistryMutation(registry => {
            const target = registry.entries[id];
            if (!target) {
                return;
            }
            const next = description?.trim();
            if (next) {
                target.description = next;
            } else {
                delete target.description;
            }
        });
    }

    /**
     * Whether a variable can be removed right now.
     *
     * ⚠ **False for the length of a live session, and that is a ruling rather than a limitation.**
     * Removing a variable does not only take the entry: every `Get`/`Set` node that named it has its
     * `savedVariableId` / `persistentVariableId` param cleared, and that is a write to the blueprint
     * document - which a session does not carry, because no operation is about it. A verb that
     * removed the entry and left those nodes behind would give every author in the room a blueprint
     * that fails at runtime with nothing on screen saying why.
     *
     * Refused here rather than left to the write boundary, for the reason `AssetsService` refuses an
     * import: `editor/variables.json` IS writable during a session, so a deletion that reached the
     * boundary would be allowed - and would land on this machine and nowhere else.
     */
    public canDeleteEntry(): boolean {
        return this.opSink === null;
    }

    /** Remove one entry. False when a live session owns this registry - see {@link canDeleteEntry}. */
    public deleteEntry(id: string): boolean {
        if (!this.canDeleteEntry()) {
            return false;
        }
        this.applyRegistryMutation(registry => {
            delete registry.entries[id];
        });
        return true;
    }

    /**
     * Replace the whole registry (blueprint history restore). Sets + emits without touching history.
     *
     * ⚠ **Refused while a live session owns the registry**, and for the reason undo inside a session
     * is an inverse operation rather than a snapshot: putting a whole registry back would overwrite
     * every entry everybody else has edited since, on this machine alone, with nothing anywhere
     * reporting it. False says the restore did not happen.
     */
    public replaceRegistry(registry: VariableRegistry): boolean {
        if (this.opSink !== null) {
            return false;
        }
        this.registry = registry;
        this.revision += 1;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("registryChanged", registry);
        return true;
    }

    /* --------------------------------------------------------------- the live-session seam */

    /** Send registry edits somewhere else, or take them back. Null restores ordinary behaviour. */
    public setOperationSink(sink: VariableOpSink | null): void {
        this.opSink = sink;
    }

    /**
     * Whether this window holds a readable registry.
     *
     * What decides whether a session carries this document at all. False after an unreadable read:
     * the in-memory registry is then an empty stand-in for a file nobody could parse, and applying
     * operations to it would build a registry that has nothing to do with what is on disk - which
     * {@link save} would then refuse to write, leaving this machine's copy of a shared document
     * permanently apart from everybody else's.
     */
    public isReadable(): boolean {
        return this.unreadable === null && this.registry !== null;
    }

    /**
     * Apply one operation to the registry, **without consulting the sink**.
     *
     * The other side of the seam: what a live session calls when an effect arrives and the panel is
     * finally allowed to move.
     *
     * ⚠ An update naming an entry that is not here is a no-op rather than a throw, for the reason
     * the localization applier tolerates a language it does not hold: an applier runs inside reading
     * a message, and one that threw would take the session down over one row. The divergence guard is
     * what catches it instead, on this very effect - a missing entry has a digest of its own.
     */
    public applyLiveOp(op: LiveVariableOp): void {
        switch (op.op) {
            case "create-variable":
                this.applyRegistryMutation(registry => {
                    registry.entries[op.entry.id] = { ...op.entry };
                });
                return;
            case "update-variable":
                this.applyRegistryMutation(registry => {
                    if (!registry.entries[op.variableId]) {
                        return;
                    }
                    registry.entries[op.variableId] = { ...op.entry };
                });
                return;
            case "delete-variable":
                // ⚠ No node-ref sweep, and that is correct rather than missing: this verb is only
                // ever the inverse of a creation made inside the session, and blueprint editing is
                // frozen throughout one - so there is provably no node pointing at it. An authored
                // deletion, which does need the sweep, is refused instead. See {@link canDeleteEntry}.
                this.applyRegistryMutation(registry => {
                    delete registry.entries[op.variableId];
                });
                return;
            default: {
                // A verb with no applier would otherwise be a silent no-op: the effect lands on every
                // other machine in the room and not on this one, and nothing says so until a digest
                // disagrees one message later.
                const unapplied: never = op;
                throw new RendererError(`No applier for live variable operation: ${JSON.stringify(unapplied)}`);
            }
        }
    }

    /**
     * Hand one entry to the sink, as it would have been written. True means a session took it.
     *
     * The one place an `update-variable` is stated, so that every mutator states the same thing about
     * the same document and none of them can come to send a patch instead.
     */
    private stated(next: VariableRegistryEntry): boolean {
        return this.opSink?.handle({ op: "update-variable", variableId: next.id, entry: next }) === true;
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
