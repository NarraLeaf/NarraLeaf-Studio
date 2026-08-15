import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { saveSchemaSpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import { RendererError } from "@shared/utils/error";
import type { LiteralValue } from "@shared/types/blueprint/document";
import {
    SAVE_SCHEMA_VERSION,
    type SaveSchema,
    type SaveSchemaField,
    type SaveSchemaFieldType,
} from "@shared/types/saveSchema";
import {
    createEmptySaveSchema,
    defaultValueForSaveSchemaFieldType,
    deriveSaveSchemaStorageKey,
    listSaveSchemaFields,
    normalizeSaveSchemaFieldType,
} from "@shared/saves/saveSchemaModel";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { Service } from "../Service";
import { Services, ISaveSchemaService, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { UuidService } from "../core/UuidService";
import { EventEmitter } from "../ui/EventEmitter";
import { setActiveSaveSchemaFields } from "@shared/saves/saveSchemaRegistry";

type SaveSchemaServiceEvents = {
    schemaChanged: SaveSchema;
    dirtyChanged: boolean;
};

/**
 * What one save slot carries besides the engine's own record. Owns `editor/save-schema.json`.
 *
 * Mirrors {@link BrandService} and {@link VariableRegistryService} - one project JSON, seeded from
 * absence, revision + debounced autosave, change events, and the same refuse-to-overwrite latch -
 * because it is the same class of thing: a small project-level table many editors reference and
 * version control has to see row by row.
 *
 * It has no panel of its own, and that is deliberate. The schema is edited from the popover on a
 * `Save Game` / `Get Save Metadata` node card, where the author is already looking at the pins it
 * grows; a fifth project table in the sidebar would ask them to go somewhere else to answer a
 * question they are being asked here. What makes that safe is that the popover edits *this*
 * document rather than the node it was opened from - the write node and the read node are a
 * contract across time, and twelve node-local copies of it (which is what the skeleton's six slots
 * would need) drift by hand and fail silently.
 *
 * Undo rides the blueprint history channel, exactly as the variable registry does: `LocalBlueprintService`
 * captures a schema snapshot alongside the blueprint document, so a field added from the popover is
 * one Ctrl+Z in the blueprint editor. {@link replaceSchema} exists for that restore.
 */
export class SaveSchemaService extends Service<SaveSchemaService> implements ISaveSchemaService {
    private schema: SaveSchema | null = null;
    /**
     * Set when `editor/save-schema.json` is on disk but could not be parsed, and never cleared until
     * a load succeeds. Everything else carries on - a project with one broken document still has to
     * open - but {@link save} refuses while it is set: the in-memory schema is empty, and writing
     * that over the file would turn "unreadable" into "every save field the author declared is gone",
     * which also silently unwires every pin grown from them.
     */
    private unreadable: DocumentCorruptError | null = null;
    private readonly events = new EventEmitter<SaveSchemaServiceEvents>();
    private dirty = false;
    private revision = 0;
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.save(this.getSchema()),
        onError: err => console.warn("[SaveSchemaService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, projectService, uuidService]);
        await registerAutoSaver(ctx, depend, "saveSchema", "workspace.shell.save.stores.saveSchema", this.autoSaver);

        await this.load();
    }

    public async load(): Promise<SaveSchema> {
        const result = await loadDocument(saveSchemaSpec, this.storage(), saveSchemaSpec.pathFor());
        // Both cleared before the branch: these services are singletons that re-init on a project
        // switch, and either one carried over would be the previous project speaking for this one.
        this.unreadable = null;
        this.revision = 0;

        if (result.status === "missing") {
            // Seeded empty rather than left absent, for the reason its siblings are: a document that
            // appears out of nowhere three commits later is a diff nobody can explain. An empty
            // schema is also the state every existing project is in, and it is a working one - the
            // raw `metadata` pin is still there when no field is declared.
            this.schema = createEmptySaveSchema();
            await this.save(this.schema);
            return this.getSchema();
        }

        if (result.status === "corrupt") {
            // Reported and survived, not thrown: this runs inside `init`, and throwing here is how
            // one unreadable document stops the whole project from opening.
            this.unreadable = result.error;
            this.schema = createEmptySaveSchema();
            reportUnreadableDocument(this.getContext(), result);
        } else {
            this.schema = result.document;
        }

        this.setDirty(false);
        this.emitSchemaChanged();
        return this.getSchema();
    }

    public async save(schema: SaveSchema): Promise<void> {
        if (this.unreadable) {
            throw new RendererError(
                `Refusing to write ${this.unreadable.path}: it is on disk but could not be read `
                + `(${this.unreadable.reason}), so anything written now would replace it with an empty schema.`,
            );
        }
        this.autoSaver.cancel();
        const updated: SaveSchema = { ...schema, schemaVersion: SAVE_SCHEMA_VERSION };
        await saveDocument(saveSchemaSpec, this.storage(), saveSchemaSpec.pathFor(), updated);
        this.schema = updated;
        this.setDirty(false);
        this.emitSchemaChanged();
    }

    public getSchema(): SaveSchema {
        if (!this.schema) {
            throw new RendererError("Save schema not initialized");
        }
        return this.schema;
    }

    /** Every declared field in pin order. The array is a copy; edit through the mutators. */
    public listFields(): SaveSchemaField[] {
        return listSaveSchemaFields(this.schema);
    }

    public getField(id: string): SaveSchemaField | undefined {
        return this.schema?.fields[id];
    }

    /**
     * A new field, appended after the existing ones.
     *
     * The storage key is derived from the name once, here, and never again: it is the key already
     * written into every save file on a player's disk, so following a rename would orphan them all.
     */
    public createField(input?: { name?: string; valueType?: SaveSchemaFieldType }): SaveSchemaField {
        const id = this.generateFieldId();
        const valueType = normalizeSaveSchemaFieldType(input?.valueType);
        const name = input?.name?.trim() || id;
        const field: SaveSchemaField = {
            id,
            name,
            valueType,
            storageKey: deriveSaveSchemaStorageKey(name, id, this.listFields().map(f => f.storageKey)),
            defaultValue: defaultValueForSaveSchemaFieldType(valueType),
            order: this.nextOrder(),
        };
        this.applySchemaMutation(fields => ({ ...fields, [id]: field }));
        return this.getField(id) ?? field;
    }

    /**
     * Patch one field. `id` and `storageKey` are not patchable, for the reason above: one is what
     * every pin is named after, the other is what every save file is keyed by.
     *
     * Retyping keeps the author's default only when it still fits the new type - carrying a string
     * default onto a boolean field would put a value on the pin that its own type rejects.
     */
    public updateField(
        id: string,
        patch: { name?: string; valueType?: SaveSchemaFieldType; defaultValue?: LiteralValue; description?: string },
    ): void {
        this.applySchemaMutation(fields => {
            const current = fields[id];
            if (!current) {
                return fields;
            }
            const next: SaveSchemaField = { ...current };
            if (patch.name !== undefined) {
                const name = patch.name.trim();
                if (name) {
                    next.name = name;
                }
            }
            if (patch.valueType !== undefined) {
                const valueType = normalizeSaveSchemaFieldType(patch.valueType);
                if (valueType !== current.valueType) {
                    next.valueType = valueType;
                    next.defaultValue = defaultValueForSaveSchemaFieldType(valueType);
                }
            }
            if (patch.defaultValue !== undefined) {
                next.defaultValue = patch.defaultValue;
            }
            if (patch.description !== undefined) {
                const description = patch.description.trim();
                if (description) {
                    next.description = description;
                } else {
                    // Removed rather than blanked: the canonical encoder refuses an explicit
                    // `undefined`, so the field the author just cleared would stop the file saving.
                    delete next.description;
                }
            }
            return { ...fields, [id]: next };
        });
    }

    /**
     * Drop a field.
     *
     * The values already written under its storage key stay in every save file that has them. That
     * is deliberate: deleting a declaration is an authoring act, and rewriting the player's saves to
     * match is not something an editor should do behind their back. Re-adding a field with the same
     * key reads them again.
     */
    public deleteField(id: string): boolean {
        if (!this.getField(id)) {
            return false;
        }
        this.applySchemaMutation(fields => {
            const next = { ...fields };
            delete next[id];
            return next;
        });
        return true;
    }

    /** Move `id` to sit before `beforeId`, or to the end when that is null. */
    public moveField(id: string, beforeId: string | null): void {
        const ordered = this.listFields();
        const moving = ordered.find(field => field.id === id);
        if (!moving || id === beforeId) {
            return;
        }
        const rest = ordered.filter(field => field.id !== id);
        const at = beforeId === null ? rest.length : rest.findIndex(field => field.id === beforeId);
        const target = at < 0 ? rest.length : at;
        rest.splice(target, 0, moving);
        this.applySchemaMutation(fields => {
            const next: Record<string, SaveSchemaField> = {};
            rest.forEach((field, index) => {
                next[field.id] = { ...fields[field.id], order: index };
            });
            return next;
        });
    }

    /** Whole-document restore, for the blueprint history channel. */
    public replaceSchema(schema: SaveSchema): void {
        this.schema = { ...schema, schemaVersion: SAVE_SCHEMA_VERSION };
        this.revision += 1;
        this.setDirty(true);
        this.emitSchemaChanged();
        this.autoSaver.schedule();
    }

    /** Write out anything the auto-save timer still owes, and wait for it. */
    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    public onSchemaChanged(handler: (schema: SaveSchema) => void): () => void {
        return this.events.on("schemaChanged", handler);
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

    private applySchemaMutation(mutator: (fields: Record<string, SaveSchemaField>) => Record<string, SaveSchemaField>): void {
        const current = this.getSchema();
        this.schema = { ...current, fields: mutator(current.fields) };
        this.revision += 1;
        this.setDirty(true);
        this.emitSchemaChanged();
        this.autoSaver.schedule();
    }

    private nextOrder(): number {
        const fields = this.listFields();
        return fields.length === 0 ? 0 : fields[fields.length - 1].order + 1;
    }

    private generateFieldId(): string {
        return this.getContext().services.get<UuidService>(Services.Uuid).generate();
    }

    private setDirty(dirty: boolean): void {
        if (this.dirty === dirty) {
            return;
        }
        this.dirty = dirty;
        this.events.emit("dirtyChanged", dirty);
    }

    /**
     * Hand the window back an empty schema.
     *
     * The live schema is module-level and outlives this service's context, so a project closed
     * without this would leave its fields growing pins on the next project's save nodes, for as
     * long as it took that project's own document to load.
     */
    public dispose(): void {
        setActiveSaveSchemaFields([]);
    }

    /**
     * Announce, and publish.
     *
     * Both halves on every change: subscribers repaint from the event, and pin resolution - which is
     * not a subscriber but a function called from the canvas, the validator, the linter and the
     * graph runtime - reads the published list. The push is content-compared upstream, so emitting
     * on every mutation costs nothing when nothing moved.
     */
    private emitSchemaChanged(): void {
        setActiveSaveSchemaFields(this.listFields());
        this.events.emit("schemaChanged", this.getSchema());
    }

    private storage(): DocumentStorage {
        return createProjectDocumentStorage(this.getContext());
    }
}
