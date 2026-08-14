import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { appTagsSpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import { RendererError } from "@shared/utils/error";
import {
    APP_TAG_OVERRIDE_KEYS,
    createEmptyAppTagDocument,
    hasAppTag,
    hasAppTagPluginConfig,
    hasAppTagReachableScenes,
    isBuiltinAppTagId,
    listAppTags,
    normalizeAppTagEndingSurfaceId,
    normalizeAppTagExternalLinks,
    normalizeAppTagPluginConfig,
    normalizeAppTagReachableScenes,
    normalizeProjectAppTags,
    RELEASE_APP_TAG,
    resolveAppTag,
    resolveAppTagEndingSurface,
    resolveAppTagExternalLinks,
    resolveAppTagIdentity,
    resolveAppTagPluginConfigValue,
    resolveAppTagReachableScenes,
    uniqueAppTagName,
    variantStorablePluginConfig,
    type AppTagBaseIdentity,
    type AppTagDeclaredScene,
    type AppTagIdentity,
    type AppTagOverrideKey,
    type AppTagPluginConfig,
    type AppTagReachableScenes,
    type AppTagResolvedEndingSurface,
    type AppTagResolvedExternalLinks,
    type AppTagResolvedValue,
    type ProjectAppTag,
    type ProjectAppTagDocument,
} from "@shared/types/appTag";
import type { GameBuildPlatform } from "@shared/types/gameBuild";
import {
    isPlatformScopedBuildConfig,
    isVariantScopedBuildConfig,
    pluginBuildConfigStorageKey,
    type PluginBuildConfigField,
} from "@shared/types/plugins";
import type { TranslationKey } from "@shared/i18n";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { Service } from "../Service";
import { Services, IAppTagService, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { UuidService } from "../core/UuidService";
import { HistoryService } from "../history/HistoryService";
import type { HistoryLabel } from "../history/historyModel";
import { projectHistoryScope } from "../history/historyScopes";
import { EventEmitter } from "../ui/EventEmitter";

type AppTagServiceEvents = {
    tagsChanged: ProjectAppTag[];
    dirtyChanged: boolean;
};

/**
 * What the Edit menu and the undo tooltip call one of these steps.
 *
 * Four rather than one per mutator: the three an author performs deliberately and would look for by
 * name, and one for every field edit. "Undo edit build variants" is vague about which field, and
 * that is the honest reading of an undo unit that is the whole document.
 */
const APP_TAG_EDIT_LABEL: HistoryLabel = { key: "project.appTags.history.edit" as TranslationKey };

function appTagLabel(key: string, name: string): HistoryLabel {
    return { key: `project.appTags.history.${key}` as TranslationKey, params: { name } };
}

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
 *
 * **Every mutation is one undo step on the project stack.** A variant is not "in" a document the
 * author has open, which is exactly what `HistoryScopeKind.Project` is for - the same stack that
 * holds creating and deleting characters, assets and scenes. Before this, deleting a variant was
 * guarded by its confirmation and by nothing else, so an author who confirmed too fast had lost the
 * overrides for good; the confirmation stays, because it still says what the deletion strands.
 *
 * The undo unit is the whole document, not the field that changed. It is a small table, and the
 * alternative - an inverse per mutator - is fourteen inverses that each have to stay correct as the
 * record grows a key.
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
        const {
            pluginConfig: rawPluginConfig,
            reachableScenes: rawReachableScenes,
            externalLinks: rawExternalLinks,
            endingSurfaceId: rawEndingSurfaceId,
            ...rest
        } = document;
        const pluginConfig = normalizeAppTagPluginConfig(rawPluginConfig);
        const reachableScenes = normalizeAppTagReachableScenes(rawReachableScenes);
        const externalLinks = normalizeAppTagExternalLinks(rawExternalLinks);
        const endingSurfaceId = normalizeAppTagEndingSurfaceId(rawEndingSurfaceId);
        const updated: ProjectAppTagDocument = {
            ...rest,
            tags: normalizeProjectAppTags(document.tags),
            // Spread onto a document the key was destructured out of, so a record emptied by the
            // author's last clear leaves the file rather than sitting there as `{}`.
            ...(hasAppTagPluginConfig(pluginConfig) ? { pluginConfig } : {}),
            ...(hasAppTagReachableScenes(reachableScenes) ? { reachableScenes } : {}),
            ...(externalLinks.length > 0 ? { externalLinks } : {}),
            ...(endingSurfaceId ? { endingSurfaceId } : {}),
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
    public applyTagMutation(
        mutator: (tags: ProjectAppTag[]) => ProjectAppTag[],
        label: HistoryLabel = APP_TAG_EDIT_LABEL,
    ): void {
        // Re-normalized on every mutation rather than only on load, so nothing a caller does can put
        // a duplicate id, a stored release tag or a blank override into memory.
        this.applyDocumentMutation(document => {
            document.tags = mutator([...document.tags]);
        }, label);
    }

    /**
     * The one write path. Mutate the document, re-normalize both halves of it, then commit.
     *
     * Re-normalized on every mutation rather than only on load, so nothing a caller does can put a
     * duplicate id, a stored release tag, a blank override or a blank plugin value into memory.
     *
     * The snapshot pair is taken here, around the normalization, so what an undo restores is a
     * document that has already been through it - never a caller's half-built one.
     */
    private applyDocumentMutation(
        mutate: (document: ProjectAppTagDocument) => void,
        label: HistoryLabel = APP_TAG_EDIT_LABEL,
    ): void {
        const document = this.getDocument();
        const before = structuredClone(document);
        mutate(document);
        document.tags = normalizeProjectAppTags(document.tags);
        const pluginConfig = normalizeAppTagPluginConfig(document.pluginConfig);
        if (hasAppTagPluginConfig(pluginConfig)) {
            document.pluginConfig = pluginConfig;
        } else {
            // Deleted rather than left as `{}`, so clearing the last value returns the document to
            // what it was before any plugin asked for anything.
            delete document.pluginConfig;
        }
        const reachableScenes = normalizeAppTagReachableScenes(document.reachableScenes);
        if (hasAppTagReachableScenes(reachableScenes)) {
            document.reachableScenes = reachableScenes;
        } else {
            delete document.reachableScenes;
        }
        const externalLinks = normalizeAppTagExternalLinks(document.externalLinks);
        if (externalLinks.length > 0) {
            document.externalLinks = externalLinks;
        } else {
            // Deleted rather than left as `[]` for the same reason: on the project's own record
            // "declares none" and "the key is absent" are one fact, unlike on a variant, where an
            // empty list is the variant saying it opens nothing.
            delete document.externalLinks;
        }
        const endingSurfaceId = normalizeAppTagEndingSurfaceId(document.endingSurfaceId);
        if (endingSurfaceId) {
            document.endingSurfaceId = endingSurfaceId;
        } else {
            // Deleted rather than left blank, for the reason the list above is deleted when empty:
            // on the project's own record "picks none" and "the key is absent" are one fact.
            delete document.endingSurfaceId;
        }
        this.commitMutation();
        this.recordUndoStep(before, structuredClone(document), label);
    }

    /**
     * One undo step for one mutation.
     *
     * Restoring goes through {@link commitMutation} rather than through the mutators, so an undo
     * cannot be re-normalized into something other than what the author had: the snapshot already
     * is normalized. `HistoryService` suppresses recording while an undo runs, so the restore does
     * not push an entry of its own.
     */
    private recordUndoStep(
        before: ProjectAppTagDocument,
        after: ProjectAppTagDocument,
        label: HistoryLabel,
    ): void {
        const restore = (snapshot: ProjectAppTagDocument) => {
            this.document = structuredClone(snapshot);
            this.commitMutation();
        };
        this.getContext().services.get<HistoryService>(Services.History).pushCommand(projectHistoryScope(), {
            label,
            undo: () => restore(before),
            redo: () => restore(after),
        });
    }

    /**
     * Everything a mutation owes regardless of which half of the document it touched.
     *
     * The project's own plugin values live at the document root rather than on a tag, so they cannot
     * go through {@link applyTagMutation} - but they are the same document, the same autosave and
     * the same event, and splitting the bookkeeping is how one of the two ends up not marking the
     * project dirty.
     */
    private commitMutation(): void {
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
            // Uniquified rather than taken as given. Every caller has a sensible default name to
            // offer ("New Variant"), and offering the same one twice is what a second press of Add
            // does - so pressing it twice must produce two names, not two rows nothing can tell
            // apart.
            name: uniqueAppTagName(this.takenNames(null), input?.name ?? ""),
            overrides: {},
        };
        this.applyTagMutation(tags => [...tags, tag], appTagLabel("add", tag.name));
        return this.getTag(tag.id) ?? tag;
    }

    /**
     * Every name a new or renamed tag must differ from: the other stored tags, and the release
     * tag's own name, which is what every surface shows for it in every language.
     */
    private takenNames(excludeId: string | null): string[] {
        return [
            RELEASE_APP_TAG.name,
            ...this.getDocument().tags.filter(tag => tag.id !== excludeId).map(tag => tag.name),
        ];
    }

    /**
     * Rename. Blank is refused rather than stored, because the normalizer would fall it back to the
     * id and put a generated string on the surface as if the author had typed it.
     *
     * A name already in use is numbered rather than refused, for the reason {@link createTag} gives:
     * a refused rename leaves the field holding a name the project does not have, while a numbered
     * one is on screen and can be edited again. So the caller reads the stored name back rather than
     * assuming it got what it asked for.
     *
     * Stored references hold the id, so nothing has to be rewritten: every place naming this tag
     * follows the new name by construction.
     */
    public renameTag(id: string, name: string): boolean {
        const next = name.trim();
        if (!next || isBuiltinAppTagId(id) || !this.getTag(id)) {
            return false;
        }
        const unique = uniqueAppTagName(this.takenNames(id), next);
        this.applyTagMutation(
            tags => tags.map(tag => (tag.id === id ? { ...tag, name: unique } : tag)),
            appTagLabel("rename", unique),
        );
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

    /** The project's own plugin values - what a variant states nothing against. A copy. */
    public getProjectPluginConfig(): AppTagPluginConfig {
        return clonePluginConfig(this.getDocument().pluginConfig ?? {});
    }

    /** Only the plugin values this variant states itself. A copy; empty for the release tag. */
    public getVariantPluginConfig(id: string | null | undefined): AppTagPluginConfig {
        const tag = this.resolveTag(id);
        return clonePluginConfig(tag.pluginConfig ?? {});
    }

    /**
     * What one plugin field is set to under `id`, and whether the variant states it.
     *
     * `platform` is read only for the platform-taking scopes; passing one for a `global` or
     * `variant` field is harmless and passing none for a platform-scoped field answers blank, which
     * is the honest reading of "no platform, so no value for one".
     */
    public resolvePluginConfigValue(
        id: string | null | undefined,
        field: PluginBuildConfigField,
        platform?: GameBuildPlatform,
    ): AppTagResolvedValue {
        return resolveAppTagPluginConfigValue(
            this.resolveTag(id),
            this.getDocument().pluginConfig ?? {},
            field,
            platform,
        );
    }

    /**
     * State one plugin field's value.
     *
     * Where it lands is the field's business, not the caller's: a `global`- or `platform`-scoped
     * field is written on the project whatever variant is selected, because it has one value for the
     * whole project, and so is a variant-scoped field written while the release tag is selected - the
     * release tag stores nothing, and the project's record is what it reads.
     *
     * A blank value clears it, for the reason {@link setOverride} gives: "" is not a value a build
     * can ship with, and clearing a field is how an author says "inherit this again".
     */
    public setPluginConfigValue(
        id: string | null | undefined,
        field: PluginBuildConfigField,
        value: string,
        platform?: GameBuildPlatform,
    ): boolean {
        const next = value.trim();
        if (!next) {
            return this.clearPluginConfigValue(id, field, platform);
        }
        return this.writePluginConfigValue(id, field, platform, next);
    }

    /**
     * Restore one plugin field to the inherited value, or - on the project's own record - unset it.
     *
     * A delete, not a write of the inherited string: storing what was inherited would freeze it, and
     * the next edit to the project would leave this variant quietly saying the old thing.
     */
    public clearPluginConfigValue(
        id: string | null | undefined,
        field: PluginBuildConfigField,
        platform?: GameBuildPlatform,
    ): boolean {
        return this.writePluginConfigValue(id, field, platform, null);
    }

    /** Restore every plugin value this variant states. Same delete rule, applied across the record. */
    public clearAllPluginConfig(id: string): boolean {
        if (isBuiltinAppTagId(id) || !this.getTag(id)) {
            return false;
        }
        this.applyTagMutation(tags => tags.map(tag => (
            tag.id === id ? { ...tag, pluginConfig: {} } : tag
        )));
        return true;
    }

    /**
     * Write or delete one field's value in whichever record the field's scope says owns it.
     *
     * Writing a field a variant cannot state also sweeps that field off every variant. Such an entry
     * is inert - resolution never reads it - but leaving it there would let one field have two
     * stored answers, and a later reader could pick either. It is swept here rather than on load
     * because only a caller holding the declaration knows the scope: a sweep that guessed would
     * delete the values of a plugin that is merely not installed on this machine.
     */
    private writePluginConfigValue(
        id: string | null | undefined,
        field: PluginBuildConfigField,
        platform: GameBuildPlatform | undefined,
        value: string | null,
    ): boolean {
        const storageKey = pluginBuildConfigStorageKey(
            field.key,
            isPlatformScopedBuildConfig(field.scope) ? platform : undefined,
        );
        const trimmedId = typeof id === "string" ? id.trim() : "";
        const onProject = !isVariantScopedBuildConfig(field.scope)
            || !trimmedId
            || isBuiltinAppTagId(trimmedId);

        if (!onProject && !this.getTag(trimmedId)) {
            return false;
        }
        this.applyDocumentMutation(document => {
            if (onProject) {
                document.pluginConfig = writePluginValue(
                    document.pluginConfig ?? {},
                    field.pluginId,
                    storageKey,
                    value,
                );
                if (!isVariantScopedBuildConfig(field.scope)) {
                    document.tags = document.tags.map(tag => ({
                        ...tag,
                        pluginConfig: variantStorablePluginConfig(tag.pluginConfig ?? {}, [field]),
                    }));
                }
                return;
            }
            document.tags = document.tags.map(tag => (tag.id === trimmedId
                ? {
                    ...tag,
                    pluginConfig: writePluginValue(
                        tag.pluginConfig ?? {},
                        field.pluginId,
                        storageKey,
                        value,
                    ),
                }
                : tag));
        });
        return true;
    }

    /** The project's own declared addresses - what a variant that states none reads. A copy. */
    public getProjectExternalLinks(): string[] {
        return [...(this.getDocument().externalLinks ?? [])];
    }

    /** What this variant may open, and whether it is the reason. */
    public resolveExternalLinks(id: string | null | undefined): AppTagResolvedExternalLinks {
        return resolveAppTagExternalLinks(this.resolveTag(id), this.getDocument().externalLinks);
    }

    /**
     * State the list for one variant, or - on the release tag - for the project.
     *
     * The release tag stores nothing, so a list stated while it is selected is the project's own,
     * exactly as a variant-scoped plugin value is. Entries that are not absolute web addresses are
     * dropped by the normalizer; the surface refuses them before they get here, and this is what
     * makes that true of every other caller too.
     */
    public setExternalLinks(id: string | null | undefined, links: readonly string[]): boolean {
        const trimmedId = typeof id === "string" ? id.trim() : "";
        const onProject = !trimmedId || isBuiltinAppTagId(trimmedId);
        if (!onProject && !this.getTag(trimmedId)) {
            return false;
        }
        const next = normalizeAppTagExternalLinks([...links]);
        this.applyDocumentMutation(document => {
            if (onProject) {
                document.externalLinks = next;
                return;
            }
            document.tags = document.tags.map(tag => (
                tag.id === trimmedId ? { ...tag, externalLinks: next } : tag
            ));
        });
        return true;
    }

    /**
     * Restore a variant to the project's list.
     *
     * A delete, not a copy of what was inherited: storing the project's addresses here would freeze
     * them, and the next address the project gains would be missing from this variant with nothing
     * saying so. Refuses the release tag, which has nothing to restore to.
     */
    public clearExternalLinks(id: string): boolean {
        if (isBuiltinAppTagId(id) || !this.getTag(id)) {
            return false;
        }
        this.applyDocumentMutation(document => {
            document.tags = document.tags.map(tag => {
                if (tag.id !== id) {
                    return tag;
                }
                const { externalLinks: _dropped, ...rest } = tag;
                return rest;
            });
        });
        return true;
    }

    /** The project's own ending page - what a variant that states none reads. Blank picks none. */
    public getProjectEndingSurfaceId(): string {
        return this.getDocument().endingSurfaceId ?? "";
    }

    /** Which page a build under this variant ends on, and whether the variant is the reason. */
    public resolveEndingSurface(id: string | null | undefined): AppTagResolvedEndingSurface {
        return resolveAppTagEndingSurface(this.resolveTag(id), this.getDocument().endingSurfaceId);
    }

    /**
     * State the ending page for one variant, or - on the release tag - for the project.
     *
     * The release tag stores nothing, so a page picked while it is selected is the project's own,
     * exactly as the address list is. A blank value on a variant is a value, not a clear: it says
     * this edition shows nothing when its story ends, which a demo whose cut point is its ending may
     * well mean. Restoring the inherited page is {@link clearEndingSurface}.
     */
    public setEndingSurface(id: string | null | undefined, surfaceId: string): boolean {
        const trimmedId = typeof id === "string" ? id.trim() : "";
        const onProject = !trimmedId || isBuiltinAppTagId(trimmedId);
        if (!onProject && !this.getTag(trimmedId)) {
            return false;
        }
        const next = normalizeAppTagEndingSurfaceId(surfaceId);
        this.applyDocumentMutation(document => {
            if (onProject) {
                document.endingSurfaceId = next;
                return;
            }
            document.tags = document.tags.map(tag => (
                tag.id === trimmedId ? { ...tag, endingSurfaceId: next } : tag
            ));
        });
        return true;
    }

    /**
     * Restore a variant to the project's ending page.
     *
     * A delete, not a copy of what was inherited: storing the project's page here would freeze it,
     * and the next page the project picked would quietly not reach this variant. Refuses the release
     * tag, which has nothing to restore to.
     */
    public clearEndingSurface(id: string): boolean {
        if (isBuiltinAppTagId(id) || !this.getTag(id)) {
            return false;
        }
        this.applyDocumentMutation(document => {
            document.tags = document.tags.map(tag => {
                if (tag.id !== id) {
                    return tag;
                }
                const { endingSurfaceId: _dropped, ...rest } = tag;
                return rest;
            });
        });
        return true;
    }

    /**
     * Every address any build of this project could open, project and variants together.
     *
     * The union rather than one variant's list, because its readers are not building anything: the
     * picker on an Open Link node has no variant selected, and a check that judged a graph against
     * one variant would report a link the demo build opens as a mistake. Which variant actually
     * opens which address is decided when a build is compiled.
     */
    public listDeclaredExternalLinks(): string[] {
        const document = this.getDocument();
        return normalizeAppTagExternalLinks([
            ...(document.externalLinks ?? []),
            ...document.tags.flatMap(tag => tag.externalLinks ?? []),
        ]);
    }

    /**
     * What the author says each unreadable mechanism can start under `id`: the project's own
     * declarations with this variant's own replacing them key by key.
     *
     * The one entry the solver and the build gate read, so a declaration a surface shows and a
     * declaration a build acts on can never be two different answers.
     */
    public resolveReachableScenes(id: string | null | undefined): AppTagReachableScenes {
        return resolveAppTagReachableScenes(this.resolveTag(id), this.getDocument().reachableScenes);
    }

    /** Only the declarations this variant states itself. A copy; empty for the release tag. */
    public getVariantReachableScenes(id: string | null | undefined): AppTagReachableScenes {
        return cloneReachableScenes(this.resolveTag(id).reachableScenes ?? {});
    }

    /**
     * State what one mechanism can start under `id`.
     *
     * The release tag writes the project's record, which is what every other variant inherits - it
     * stores nothing of its own, so there is nowhere else for its answer to go. An empty list is a
     * write, not a clear: "this starts nothing here" is a declaration, and it is what a demo says
     * about the chapter select the main build uses. Clearing is {@link clearDeclaredScenes}.
     */
    public setDeclaredScenes(
        id: string | null | undefined,
        mechanismKey: string,
        scenes: readonly AppTagDeclaredScene[],
    ): boolean {
        return this.writeDeclaredScenes(id, mechanismKey, [...scenes]);
    }

    /**
     * Stop declaring one mechanism, restoring whatever the project says about it.
     *
     * A delete, not a write of the inherited list: storing what was inherited would freeze it, and
     * the next scene the project added to the mechanism would quietly not reach this variant.
     */
    public clearDeclaredScenes(id: string | null | undefined, mechanismKey: string): boolean {
        return this.writeDeclaredScenes(id, mechanismKey, null);
    }

    private writeDeclaredScenes(
        id: string | null | undefined,
        mechanismKey: string,
        scenes: AppTagDeclaredScene[] | null,
    ): boolean {
        const key = mechanismKey.trim();
        if (!key) {
            return false;
        }
        const trimmedId = typeof id === "string" ? id.trim() : "";
        const onProject = !trimmedId || isBuiltinAppTagId(trimmedId);
        if (!onProject && !this.getTag(trimmedId)) {
            return false;
        }
        this.applyDocumentMutation(document => {
            if (onProject) {
                document.reachableScenes = writeDeclaration(document.reachableScenes ?? {}, key, scenes);
                return;
            }
            document.tags = document.tags.map(tag => (tag.id === trimmedId
                ? { ...tag, reachableScenes: writeDeclaration(tag.reachableScenes ?? {}, key, scenes) }
                : tag));
        });
        return true;
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
        this.applyTagMutation(
            tags => tags.filter(tag => tag.id !== id),
            appTagLabel("delete", this.resolveTag(id).name),
        );
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

/**
 * `config` with one key set, or removed when `value` is null.
 *
 * Copied rather than mutated because these records sit inside the tags the service hands out, and a
 * caller holding a previous list must not watch it change underneath.
 */
function writePluginValue(
    config: AppTagPluginConfig,
    pluginId: string,
    storageKey: string,
    value: string | null,
): AppTagPluginConfig {
    const next = clonePluginConfig(config);
    if (value === null) {
        delete next[pluginId]?.[storageKey];
        // The plugin's record goes when its last value does, so an uninstalled plugin does not leave
        // its name in the document as the only evidence it was ever configured.
        if (next[pluginId] && Object.keys(next[pluginId]).length === 0) {
            delete next[pluginId];
        }
        return next;
    }
    next[pluginId] = { ...next[pluginId], [storageKey]: value };
    return next;
}

/** `declared` with one mechanism's list set, or removed when `scenes` is null. Copied, never mutated. */
function writeDeclaration(
    declared: AppTagReachableScenes,
    mechanismKey: string,
    scenes: AppTagDeclaredScene[] | null,
): AppTagReachableScenes {
    const next = cloneReachableScenes(declared);
    if (scenes === null) {
        delete next[mechanismKey];
        return next;
    }
    next[mechanismKey] = scenes.map(scene => ({ ...scene }));
    return next;
}

function cloneReachableScenes(declared: AppTagReachableScenes): AppTagReachableScenes {
    const clone: AppTagReachableScenes = {};
    for (const [key, scenes] of Object.entries(declared)) {
        clone[key] = scenes.map(scene => ({ ...scene }));
    }
    return clone;
}

function clonePluginConfig(config: AppTagPluginConfig): AppTagPluginConfig {
    const clone: AppTagPluginConfig = {};
    for (const [pluginId, values] of Object.entries(config)) {
        clone[pluginId] = { ...values };
    }
    return clone;
}
