import { FsRejectErrorCode } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
import type { StoryLiteralValue, StoryVariableValueType } from "@shared/types/story/document";
import {
    VARIABLE_REGISTRY_SCHEMA_VERSION,
    type VariableRegistry,
    type VariableRegistryEntry,
} from "@shared/types/variables/registry";
import {
    createEmptyVariableRegistry,
    listRegistryEntries,
    migrateVariableRegistryToLatest,
    normalizePersistentValueType,
    seedRegistryEntriesFromBlueprintPersistent,
} from "@shared/variables/variableRegistryModel";
import { ProjectNameConvention } from "../../project/nameConvention";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { Service } from "../Service";
import { Services, IVariableRegistryService, WorkspaceContext } from "../services";
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
    private readonly events = new EventEmitter<VariableRegistryServiceEvents>();
    private dirty = false;
    private revision = 0;
    private lastSavedRevision = 0;
    private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly autoSaveDelay = 800;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        const uiGraphService = ctx.services.get<UIGraphService>(Services.UIGraph);
        await depend([filesystemService, projectService, uuidService, uiGraphService]);

        await this.ensureEditorDir();
        await this.load();
    }

    public async load(): Promise<VariableRegistry> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const documentPath = this.getDocumentPath();
        const exists = await fs.isFileExists(documentPath);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access variable registry path");
        }

        if (!exists.data) {
            const created = this.createSeededRegistry();
            await this.save(created);
            this.registry = created;
            return created;
        }

        const result = await fs.readJSON<VariableRegistry>(documentPath);
        if (!result.ok) {
            if (result.error.code === FsRejectErrorCode.NOT_FOUND) {
                const created = this.createSeededRegistry();
                await this.save(created);
                this.registry = created;
                return created;
            }
            throw new RendererError(result.error.message);
        }

        if (typeof result.data?.schemaVersion === "number" && result.data.schemaVersion > VARIABLE_REGISTRY_SCHEMA_VERSION) {
            throw new RendererError("variables.json schema is newer than this Studio version");
        }
        const migrated = migrateVariableRegistryToLatest(result.data);
        this.registry = migrated;
        this.revision = 0;
        this.lastSavedRevision = 0;
        this.setDirty(false);
        this.events.emit("registryChanged", this.registry);
        return migrated;
    }

    public async save(registry: VariableRegistry): Promise<void> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        await this.ensureEditorDir();
        const documentPath = this.getDocumentPath();
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
        const updated: VariableRegistry = {
            ...registry,
            meta: {
                ...registry.meta,
                updatedAt: new Date().toISOString(),
            },
        };
        const data = JSON.stringify(updated, null, 2);
        const result = await fs.write(documentPath, data, "utf-8");
        if (!result.ok) {
            throw new RendererError(result.error.message);
        }
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
            defaultValue: input?.defaultValue,
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
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = null;
            void this.save(this.getRegistry()).catch(err => {
                console.warn("[VariableRegistryService] auto-save failed", err);
            });
        }, this.autoSaveDelay);
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

    private getDocumentPath(): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorVariableRegistry);
    }

    private async ensureEditorDir(): Promise<void> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const dir = this.getContext().project.resolve(ProjectNameConvention.Editor);
        const exists = await fs.isDirExists(dir);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access editor directory");
        }
        if (!exists.data) {
            const created = await fs.createDir(dir);
            if (!created.ok) {
                throw new RendererError(created.error?.message || "Failed to create editor directory");
            }
        }
    }
}
