import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { variableRegistrySpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import { RendererError } from "@shared/utils/error";
import type { StoryLiteralValue, StoryVariableValueType } from "@shared/types/story/document";
import {
    type VariableRegistry,
    type VariableRegistryEntry,
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
import { UIGraphService } from "../ui-editor/UIGraphService";
import { EventEmitter } from "../ui/EventEmitter";

type VariableRegistryServiceEvents = {
    registryChanged: VariableRegistry;
    dirtyChanged: boolean;
};

/**
 * Project-level persistent variable registry (M-VAR). Owns `editor/variables.json`: the blueprint-
 * declared persistent variables the bible does NOT author as story rows. Mirrors {@link UIGraphService}
 * (single project JSON, migrate-on-load, revision + debounced autosave, change events).
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

    public async load(): Promise<VariableRegistry> {
        const result = await loadDocument(variableRegistrySpec, this.storage(), variableRegistrySpec.pathFor());
        // Cleared before the branch, not inside it. These services are singletons that re-init on a
        // project switch, and a latch left set by the previous project would make the next one's
        // first save refuse - i.e. one broken project would follow the author into every other.
        this.unreadable = null;

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
        }

        this.revision = 0;
        this.lastSavedRevision = 0;
        this.setDirty(false);
        this.events.emit("registryChanged", this.registry);
        return this.registry;
    }

    public async save(registry: VariableRegistry): Promise<void> {
        if (this.unreadable) {
            throw new RendererError(
                `Refusing to write ${this.unreadable.path}: it is on disk but could not be read `
                + `(${this.unreadable.reason}), so anything written now would replace it with an empty registry.`,
            );
        }
        // This write supersedes whatever the timer was going to do.
        this.autoSaver.cancel();
        const updated: VariableRegistry = {
            ...registry,
            meta: {
                ...registry.meta,
                updatedAt: new Date().toISOString(),
            },
        };
        await saveDocument(variableRegistrySpec, this.storage(), variableRegistrySpec.pathFor(), updated);
        this.registry = updated;
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

    public listEntries(): VariableRegistryEntry[] {
        return listRegistryEntries(this.getRegistry());
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

    public createEntry(input?: {
        name?: string;
        valueType?: string;
        defaultValue?: StoryLiteralValue;
        description?: string;
    }): VariableRegistryEntry {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const id = uuidService.generate();
        const entry: VariableRegistryEntry = {
            id,
            storageKey: id,
            name: input?.name?.trim() || `persist_${id.slice(0, 8)}`,
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
     * persistent variables (the field being relocated). Once WI-2 strips the field, this seed reads
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
