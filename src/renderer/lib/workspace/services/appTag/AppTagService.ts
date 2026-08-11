import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { appTagsSpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import { RendererError } from "@shared/utils/error";
import {
    APP_TAG_OVERRIDE_KEYS,
    createEmptyAppTagDocument,
    hasAppTag,
    isBuiltinAppTagId,
    listAppTags,
    normalizeProjectAppTags,
    resolveAppTag,
    resolveAppTagIdentity,
    type AppTagBaseIdentity,
    type AppTagIdentity,
    type AppTagOverrideKey,
    type ProjectAppTag,
    type ProjectAppTagDocument,
} from "@shared/types/appTag";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { Service } from "../Service";
import { Services, IAppTagService, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { UuidService } from "../core/UuidService";
import { EventEmitter } from "../ui/EventEmitter";

type AppTagServiceEvents = {
    tagsChanged: ProjectAppTag[];
    dirtyChanged: boolean;
};

/**
 * The project's build variants. Owns `editor/app-tags.json`.
 *
 * Mirrors `AudioTrackService` - single project JSON, migrate on load, revision + debounced autosave,
 * change events - because a tag is the same class of thing: a small project-level table that several
 * editors reference and version control has to see.
 *
 * Two rules distinguish it from its neighbours, and both come from the model:
 *
 * - **The release tag is never stored.** It is prepended on every read, so {@link listTags} answers
 *   at least one tag in every project, including one whose document is missing or unreadable, and
 *   {@link resolveTag} never returns nothing. Nothing here can create, rename or delete it.
 * - **Absence is the document.** A project that has never had a second variant has no file, and
 *   {@link load} does not write one - the surface would otherwise report a change in every project
 *   the author merely opened. The file appears when the first tag does.
 */
export class AppTagService extends Service<AppTagService> implements IAppTagService {
    private document: ProjectAppTagDocument | null = null;
    /**
     * Set when `editor/app-tags.json` is on disk but could not be parsed, and never cleared until a
     * load succeeds. Everything else carries on - a project with one broken document still has to
     * open - but {@link save} refuses while it is set: the in-memory list is empty, and writing that
     * over the file would turn "unreadable" into "the author's variants are gone".
     */
    private unreadable: DocumentCorruptError | null = null;
    private readonly events = new EventEmitter<AppTagServiceEvents>();
    private dirty = false;
    private revision = 0;
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.save(this.getDocument()),
        onError: err => console.warn("[AppTagService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, projectService, uuidService]);
        await registerAutoSaver(ctx, depend, "appTags", "workspace.shell.save.stores.appTags", this.autoSaver);

        await this.load();
    }

    public async load(): Promise<ProjectAppTag[]> {
        const result = await loadDocument(appTagsSpec, this.storage(), appTagsSpec.pathFor());
        // Cleared before the branch, not inside it: these services are singletons that re-init on a
        // project switch, and a latch left set by the previous project would make the next one's
        // first save refuse - one broken project following the author into every other.
        this.unreadable = null;

        if (result.status === "corrupt") {
            // Reported and survived, not thrown: this runs inside `init`, and throwing here is how
            // one unreadable document stops the whole project from opening.
            this.unreadable = result.error;
            this.document = createEmptyAppTagDocument();
            reportUnreadableDocument(this.getContext(), result);
        } else if (result.status === "missing") {
            // Held in memory and not written. Opening a project must not be a change to it, and a
            // project with only the release tag has nothing to record - the release tag is not
            // stored, so the file would be an empty list saying what absence already says.
            this.document = createEmptyAppTagDocument();
        } else {
            this.document = result.document;
        }

        this.revision = 0;
        this.setDirty(false);
        this.events.emit("tagsChanged", this.listTags());
        return this.listTags();
    }

    public async save(document: ProjectAppTagDocument): Promise<void> {
        if (this.unreadable) {
            throw new RendererError(
                `Refusing to write ${this.unreadable.path}: it is on disk but could not be read `
                + `(${this.unreadable.reason}), so anything written now would replace it with an empty list.`,
            );
        }
        // This write supersedes whatever the timer was going to do.
        this.autoSaver.cancel();
        const updated: ProjectAppTagDocument = {
            ...document,
            tags: normalizeProjectAppTags(document.tags),
            meta: {
                ...document.meta,
                updatedAt: new Date().toISOString(),
            },
        };
        await saveDocument(appTagsSpec, this.storage(), appTagsSpec.pathFor(), updated);
        this.document = updated;
        this.setDirty(false);
        this.events.emit("tagsChanged", this.listTags());
    }

    public getDocument(): ProjectAppTagDocument {
        if (!this.document) {
            throw new RendererError("App tags not initialized");
        }
        return this.document;
    }

    /** Every tag, release first. The array is a copy; edit through the mutators. */
    public listTags(): ProjectAppTag[] {
        return listAppTags(this.getDocument().tags);
    }

    /** Author-created tags only - what the document holds. */
    public listAuthoredTags(): ProjectAppTag[] {
        return [...this.getDocument().tags];
    }

    public getTag(id: string): ProjectAppTag | undefined {
        return this.listTags().find(tag => tag.id === id);
    }

    /** Whether the project has a tag under this id. The one fact every gate reads. */
    public hasTag(id: string | null | undefined): boolean {
        return hasAppTag(this.getDocument().tags, id);
    }

    /** The one resolution entry the rest of Studio should use; always answers. */
    public resolveTag(id: string | null | undefined): ProjectAppTag {
        return resolveAppTag(this.getDocument().tags, id);
    }

    /**
     * What a build under `id` is called, installed as and versioned at, and which of those the tag
     * states itself.
     *
     * `base` is the project's own identity, which lives in the `.nlproj` and is read by
     * `ProjectService` - passed in rather than fetched here so this stays a pure fold of the two, and
     * so a caller showing an unsaved edit can fold against what it is showing.
     */
    public resolveIdentity(id: string | null | undefined, base: AppTagBaseIdentity): AppTagIdentity {
        return resolveAppTagIdentity(this.resolveTag(id), base);
    }

    /** Write out anything the auto-save timer still owes, and wait for it. */
    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    public onTagsChanged(handler: (tags: ProjectAppTag[]) => void): () => void {
        return this.events.on("tagsChanged", handler);
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
    public applyTagMutation(mutator: (tags: ProjectAppTag[]) => ProjectAppTag[]): void {
        const document = this.getDocument();
        // Re-normalized on every mutation rather than only on load, so nothing a caller does can put
        // a duplicate id, a stored release tag or a blank override into memory.
        document.tags = normalizeProjectAppTags(mutator([...document.tags]));
        this.revision += 1;
        this.setDirty(true);
        this.autoSaver.schedule();
        this.events.emit("tagsChanged", this.listTags());
    }

    /**
     * A new variant, appended after the existing ones so it lands where the author is looking.
     *
     * It starts with no overrides, which is the whole of "inherits from release": a tag the author
     * has just made is the release build under another name until they say otherwise.
     */
    public createTag(input?: { name?: string }): ProjectAppTag {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const tag: ProjectAppTag = {
            id: uuidService.generate(),
            name: input?.name?.trim() || `Tag ${this.getDocument().tags.length + 1}`,
            overrides: {},
        };
        this.applyTagMutation(tags => [...tags, tag]);
        return this.getTag(tag.id) ?? tag;
    }

    /**
     * Rename. Blank is refused rather than stored, because the normalizer would fall it back to the
     * id and put a generated string on the surface as if the author had typed it.
     *
     * Stored references hold the id, so nothing has to be rewritten: every place naming this tag
     * follows the new name by construction.
     */
    public renameTag(id: string, name: string): boolean {
        const next = name.trim();
        if (!next || isBuiltinAppTagId(id) || !this.getTag(id)) {
            return false;
        }
        this.applyTagMutation(tags => tags.map(tag => (tag.id === id ? { ...tag, name: next } : tag)));
        return true;
    }

    /**
     * State one key for this tag. A blank value clears it, because "" is not a value a build can be
     * shipped with and clearing a field is how an author says "inherit this again".
     */
    public setOverride(id: string, key: AppTagOverrideKey, value: string): boolean {
        const next = value.trim();
        if (!next) {
            return this.clearOverride(id, key);
        }
        if (isBuiltinAppTagId(id) || !this.getTag(id)) {
            return false;
        }
        this.applyTagMutation(tags => tags.map(tag => (
            tag.id === id ? { ...tag, overrides: { ...tag.overrides, [key]: next } } : tag
        )));
        return true;
    }

    /**
     * Restore one key to the inherited value.
     *
     * A delete, not a write of the release value: storing what was inherited would freeze it, and the
     * next edit to the project would leave this tag quietly saying the old thing.
     */
    public clearOverride(id: string, key: AppTagOverrideKey): boolean {
        if (isBuiltinAppTagId(id) || !this.getTag(id)) {
            return false;
        }
        this.applyTagMutation(tags => tags.map(tag => {
            if (tag.id !== id) {
                return tag;
            }
            const overrides = { ...tag.overrides };
            delete overrides[key];
            return { ...tag, overrides };
        }));
        return true;
    }

    /** Restore every key. Same delete rule as {@link clearOverride}, applied across the record. */
    public clearAllOverrides(id: string): boolean {
        if (isBuiltinAppTagId(id) || !this.getTag(id)) {
            return false;
        }
        this.applyTagMutation(tags => tags.map(tag => (tag.id === id ? { ...tag, overrides: {} } : tag)));
        return true;
    }

    /** Which keys this tag states itself, in declaration order. */
    public listOverriddenKeys(id: string): AppTagOverrideKey[] {
        const tag = this.getTag(id);
        if (!tag) {
            return [];
        }
        return APP_TAG_OVERRIDE_KEYS.filter(key => tag.overrides[key] !== undefined);
    }

    /**
     * Delete a variant. Refuses the release tag - it is what every unresolvable reference falls back
     * to, and a project with no variant to build is not a state the rest of Studio can read.
     *
     * References to the deleted tag are NOT rewritten. They resolve to release from now on (see
     * {@link resolveTag}), which is why the surface tells the author how many there are before they
     * press the button rather than silently repointing them.
     */
    public deleteTag(id: string): boolean {
        if (isBuiltinAppTagId(id) || !this.getTag(id)) {
            return false;
        }
        this.applyTagMutation(tags => tags.filter(tag => tag.id !== id));
        return true;
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
