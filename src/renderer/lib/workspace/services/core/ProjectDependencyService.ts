import { getInterface } from "@/lib/app/bridge";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import {
    PROJECT_DEPENDENCY_SCHEMA_VERSION,
    createEmptyDependencyTable,
    type DependencyKind,
    type ProjectDependencyResolution,
    type ProjectDependencyTable,
    type ProjectPluginDependency,
} from "@shared/types/pluginDependencies";
import { isHeldBack, resolveDependencies } from "@shared/utils/resolveDependencies";
import { parsePluginStore } from "@shared/utils/pluginStorage";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { FsRejectErrorCode } from "@shared/types/os";
import type { PluginListItem } from "@shared/types/plugins";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { IProjectDependencyService, Services, WorkspaceContext } from "../services";
import { StoryService } from "../story/StoryService";
import type { StoryDocument } from "@shared/types/story";
import { ProjectService } from "./ProjectService";
import { FileSystemService } from "./FileSystem";
import { BlueprintNodeCatalogService } from "../ui-editor/BlueprintNodeCatalogService";
import { LocalBlueprintService } from "../ui-editor/LocalBlueprintService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";

/** Installed plugin info the scanner and resolver consume, derived from PluginListItem. */
export interface InstalledPlugin {
    id: string;
    version: string;
    enabled: boolean;
    builtIn: boolean;
    name?: string;
    publisher?: string;
}

/** A single instance of a plugin-owned type/namespace referenced by the project. */
export interface DependencyUsageRecord {
    pluginId: string;
    kind: DependencyKind;
    /** The referenced id - node type, widget type, story action, or storage namespace. */
    id: string;
    /** True when the reference breaks the document if the plugin is absent. */
    hard: boolean;
    /**
     * True when the type was attributed by its name alone, because the plugin that owns it is not
     * loaded here to claim it (see {@link attributeByNamespace}). Such a reference says the project
     * still uses the plugin; it says nothing about which version the project is being made with.
     */
    byName?: boolean;
}

/**
 * Who asked for a scan, which decides whether it may release a plugin Studio holds back.
 *
 * - `automatic` - the scans Studio runs by itself: before a run, before an export, and the live view
 *   Project ▸ App shows when it opens. They keep the table in step with what the project uses - a row
 *   for a plugin it has started to use, none for a plugin it no longer uses - and never move the
 *   version recorded for a held plugin, so a hold outlasts every run and export.
 * - `rescan` - the author pressed Rescan, in Project ▸ App or in the build dialog. That is the answer
 *   a hold waits for: every held plugin's recorded version becomes the installed one, and the hold
 *   is released.
 */
export type DependencyScanTrigger = "automatic" | "rescan";

export interface DependencyScanInput {
    /**
     * Every reference to a plugin the scan found. Complete for every plugin, loaded or not: a loaded
     * plugin's types are claimed through the registries, and anything else a project can refer to a
     * plugin by carries the plugin's id in it (see {@link attributeByNamespace}).
     */
    usage: DependencyUsageRecord[];
    installed: InstalledPlugin[];
    existing?: ProjectDependencyTable;
    /**
     * False when a document the scan reads could not be read. What a scan did not see it cannot
     * vouch for, so no recorded dependency is dropped and none loses a use it recorded.
     */
    complete: boolean;
    /** `automatic` when absent, the answer that can never release a hold by accident. */
    trigger?: DependencyScanTrigger;
}

/**
 * Owns a project's plugin dependency table: scans the project for plugin usage,
 * persists the table into the manifest, and resolves it against the plugins
 * installed on this machine. The resolution drives per-project suppression of
 * plugins whose installed major version is incompatible with the version the
 * project was authored against (see the plugin runtime loader).
 */
export class ProjectDependencyService
    extends Service<ProjectDependencyService>
    implements IProjectDependencyService {
    private resolution: ProjectDependencyResolution | null = null;
    private readonly listeners = new Set<() => void>();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        await depend([ctx.services.get<ProjectService>(Services.Project)]);
        // Resolve on open from the *persisted* table so suppression is known
        // before plugins load. Scanning is left to the moments that act on the
        // table - a run, an export, a Rescan - since a scan reads every document
        // and suppression cannot wait for one. A failure here must not block
        // opening the project.
        try {
            await this.resolve();
        } catch (error) {
            console.warn("[ProjectDependencyService] initial resolve failed", error);
            this.resolution = { entries: [], suppressedPluginIds: [], overall: "ok" };
        }
    }

    /** Latest resolution, or null before the first resolve. */
    public getResolution(): ProjectDependencyResolution | null {
        return this.resolution;
    }

    /** Plugin ids to skip loading for this project because a hard dependency is unmet. */
    public getSuppressedPluginIds(): string[] {
        return this.resolution?.suppressedPluginIds ?? [];
    }

    public onResolutionChanged(handler: () => void): () => void {
        this.listeners.add(handler);
        return () => {
            this.listeners.delete(handler);
        };
    }

    /**
     * Re-resolve the persisted table against currently-installed plugins. Safe
     * against a transient plugin-list IPC failure: it keeps the previous
     * resolution rather than treating every dependency as missing (which would
     * wrongly suppress every plugin).
     */
    public async resolve(): Promise<ProjectDependencyResolution> {
        const table = this.getProjectService().getDependencyTable() ?? createEmptyDependencyTable();
        let resolution: ProjectDependencyResolution;
        try {
            resolution = await this.computeResolution(table);
        } catch (error) {
            console.warn("[ProjectDependencyService] could not list installed plugins; skipping resolve", error);
            return this.resolution ?? { entries: [], suppressedPluginIds: [], overall: "ok" };
        }
        this.resolution = resolution;
        this.emitChanged();
        return resolution;
    }

    /**
     * Compute a live resolution from a fresh scan of current usage WITHOUT
     * persisting the table or changing suppression state. Used by the read-only
     * dependencies panel so viewing it never writes the manifest.
     *
     * An automatic scan, so a held plugin reads as held: what the panel shows on opening is what
     * the next run will do, and releasing a hold is its Rescan button's job.
     */
    public async previewResolve(): Promise<ProjectDependencyResolution> {
        return this.computeResolution(await this.rescan("automatic"));
    }

    private async computeResolution(table: ProjectDependencyTable): Promise<ProjectDependencyResolution> {
        return resolveDependencies(table, await this.listInstalledPlugins());
    }

    /**
     * Scan the project for plugin usage and produce an up-to-date table. Merges
     * with the existing table (see {@link buildDependencyTable}).
     *
     * Reads the documents as they are in memory, never off the disk. The author's latest edit may
     * still be waiting for its auto-save, and a scan that re-read the files replaced the open
     * documents with the older copies on disk - taking the edit with it - whenever a run, which
     * scans first, started within a second of one.
     *
     * `trigger` says whether the author asked for this scan (see {@link DependencyScanTrigger}).
     */
    public async rescan(trigger: DependencyScanTrigger): Promise<ProjectDependencyTable> {
        const plugins = await this.listPlugins();
        const installed = plugins.map(toInstalledPlugin);
        const existing = this.getProjectService().getDependencyTable();
        const scan: DependencyScan = {
            usage: [],
            complete: true,
            candidatePluginIds: [...new Set([
                ...(existing?.plugins ?? []).map(plugin => plugin.id),
                ...installed.map(plugin => plugin.id),
            ])],
        };
        this.collectBlueprintNodeUsage(scan);
        this.collectWidgetUsage(scan);
        await this.collectStorageUsage(scan, listPublishedNamespaces(plugins));
        await this.collectStoryActionUsage(scan);

        return buildDependencyTable({ usage: scan.usage, installed, existing, complete: scan.complete, trigger });
    }

    /**
     * Scan, persist the fresh table into the manifest, then re-resolve.
     *
     * `rescan` only for the author's own Rescan: it is the one scan that releases a held plugin.
     */
    public async rescanAndPersist(trigger: DependencyScanTrigger): Promise<ProjectDependencyResolution> {
        const table = await this.rescan(trigger);
        await this.getProjectService().setDependencyTable(table);
        return this.resolve();
    }

    private collectBlueprintNodeUsage(scan: DependencyScan): void {
        const ctx = this.getContext();
        let catalog: BlueprintNodeCatalogService;
        let document: BlueprintDocument;
        try {
            catalog = ctx.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);
            document = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint).getBlueprintDocument();
        } catch {
            scan.complete = false;
            return;
        }
        scan.usage.push(...collectBlueprintDocumentUsage(document, {
            ownerOf: type => catalog.getNodeOwner(type),
            isRegistered: type => catalog.get(type) !== undefined,
            candidatePluginIds: scan.candidatePluginIds,
        }));
    }

    private collectWidgetUsage(scan: DependencyScan): void {
        let document: InterfaceDocumentElements;
        try {
            document = this.getContext().services.get<UIDocumentService>(Services.UIDocument).getPageDocument();
        } catch {
            scan.complete = false;
            return;
        }
        scan.usage.push(...collectInterfaceDocumentUsage(document, {
            ownerOf: type => widgetModuleRegistry.getOwner(type),
            isRegistered: type => widgetModuleRegistry.has(type),
            candidatePluginIds: scan.candidatePluginIds,
        }));
    }

    /**
     * Hard dependencies from `{action:"plugin"}` marker rows.
     *
     * Hard, unlike storage, and the row itself says why: a marker's whole meaning is what its owner's
     * compile pass does with it, so a project that authored one plays differently without the plugin
     * rather than merely losing some editor convenience. The row carries `pluginId` directly, so this
     * attributes from the document and not from what happens to be installed right now - a project
     * whose plugin was uninstalled still reports the dependency, which is the case the table exists
     * for.
     *
     * Every story is loaded, not just the open ones: an unopened story's rows are dependencies too. A
     * story that fails to load is skipped rather than fatal - a dependency scan that refuses to
     * finish would block the build over a document the build is about to refuse anyway, with a worse
     * message - but it leaves the scan incomplete, so nothing it might have referred to is dropped.
     */
    private async collectStoryActionUsage(scan: DependencyScan): Promise<void> {
        let story: StoryService;
        let entries: ReturnType<StoryService["listStories"]>;
        try {
            story = this.getContext().services.get<StoryService>(Services.Story);
            entries = story.listStories();
        } catch {
            scan.complete = false;
            return;
        }

        for (const entry of entries) {
            let document: StoryDocument;
            try {
                document = await story.loadStory(entry.id);
            } catch {
                scan.complete = false;
                continue;
            }
            for (const scene of Object.values(document.scenes)) {
                for (const block of Object.values(scene.blocks)) {
                    if (block.kind === "action" && block.payload.action === "plugin") {
                        scan.usage.push({
                            pluginId: block.payload.pluginId,
                            kind: "storyAction",
                            id: block.payload.actionId,
                            hard: true,
                        });
                    }
                }
            }
        }
    }

    /**
     * Plugins that have written project storage. Attributable from the store filename on disk (see
     * {@link parsePluginStore}), so it works even when the owning plugin is not installed.
     *
     * **Whether a store is a hard dependency is the plugin's own declaration.** A namespace listed
     * in `contributes.runtimeData` is published into the game, so the shipped game reads it and the
     * pack has to carry the plugin that does the reading; anything else is editor-only data and
     * stays soft. Getting this wrong is silent in the worst way: a plugin whose whole contribution
     * is authored data - no blueprint nodes, no widgets - was classed soft, so it was dropped from
     * every pack as "enabled but unused", and its feature simply did not exist in preview or in a
     * build while the panel in Studio went on working.
     */
    private async collectStorageUsage(
        scan: DependencyScan,
        publishedNamespaces: Map<string, ReadonlySet<string>>,
    ): Promise<void> {
        const ctx = this.getContext();
        const servicesDir = ctx.project.resolve(ProjectNameConvention.EditorServices);
        const listed = await ctx.services.get<FileSystemService>(Services.FileSystem).list(servicesDir);
        if (!listed.ok) {
            // A project that has never written a store has no services directory, which is a whole
            // answer: no stores. Any other failure is a directory that could not be read.
            if (listed.error.code !== FsRejectErrorCode.NOT_FOUND) {
                scan.complete = false;
            }
            return;
        }
        for (const entry of listed.data) {
            if (entry.type !== "file" || entry.ext !== ".json") {
                continue;
            }
            const store = parsePluginStore(entry.name);
            if (store) {
                scan.usage.push({
                    pluginId: store.pluginId,
                    kind: "storage",
                    id: entry.name,
                    hard: publishedNamespaces.get(store.pluginId)?.has(store.namespace) === true,
                });
            }
        }
    }

    private async listInstalledPlugins(): Promise<InstalledPlugin[]> {
        return (await this.listPlugins()).map(toInstalledPlugin);
    }

    private async listPlugins(): Promise<PluginListItem[]> {
        const result = await getInterface().plugins.list();
        if (!result.success || !result.data) {
            throw new Error(result.success ? "Plugin list response was empty" : (result.error ?? "Failed to list plugins"));
        }
        return result.data.plugins;
    }

    private getProjectService(): ProjectService {
        return this.getContext().services.get<ProjectService>(Services.Project);
    }

    private emitChanged(): void {
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (error) {
                console.error("[ProjectDependencyService] listener failed", error);
            }
        }
    }
}

/** What one scan has gathered so far. */
interface DependencyScan {
    usage: DependencyUsageRecord[];
    /** Cleared by any collector that could not read its document. */
    complete: boolean;
    /** The plugin ids a type nothing loaded here defines may belong to: see {@link attributeByNamespace}. */
    candidatePluginIds: readonly string[];
}

/** How a collector tells whose a type is. */
export interface TypeOwnership {
    /** The loaded plugin that registered this type, if a plugin did. */
    ownerOf(type: string): string | undefined;
    /** Whether anything loaded here - Studio itself or a plugin - defines this type. */
    isRegistered(type: string): boolean;
    /** Plugin ids a type that nothing here defines may belong to. */
    candidatePluginIds: Iterable<string>;
}

/** The part of the interface document the widget scan reads: every page's elements and every component's. */
export type InterfaceDocumentElements = {
    elements: Record<string, { type: string }>;
    components?: ReadonlyArray<{ elements: Record<string, { type: string }> }>;
};

/**
 * The plugin a type that nothing loaded here defines belongs to, read off the type's name.
 *
 * Every type a plugin contributes is namespaced under the plugin's id: a manifest whose contributed
 * node or widget is not is refused at install, and registering one the manifest does not declare
 * throws. So a node or an element of type `acme.fx.shake` belongs to `acme.fx` whether or not that
 * plugin is loaded, switched on or even installed - which is what lets a scan tell "nothing refers
 * to this plugin any more" apart from "this plugin is not here to claim its types". The longest id
 * wins, so `acme.fx.pro.glow` is `acme.fx.pro`'s and not `acme.fx`'s.
 *
 * Only ids the project has recorded or this machine has installed are candidates. A type whose
 * plugin is neither has no version to record, and where its plugin id ends cannot be read off it.
 */
export function attributeByNamespace(type: string, candidatePluginIds: Iterable<string>): string | undefined {
    let owner: string | undefined;
    for (const id of candidatePluginIds) {
        if (type.startsWith(`${id}.`) && (owner === undefined || id.length > owner.length)) {
            owner = id;
        }
    }
    return owner;
}

function attributeType(type: string, kind: DependencyKind, types: TypeOwnership): DependencyUsageRecord | null {
    const owner = types.ownerOf(type);
    if (owner) {
        return { pluginId: owner, kind, id: type, hard: true };
    }
    if (types.isRegistered(type)) {
        return null; // one of Studio's own
    }
    const named = attributeByNamespace(type, types.candidatePluginIds);
    return named ? { pluginId: named, kind, id: type, hard: true, byName: true } : null;
}

/** Plugin blueprint nodes in every graph of every blueprint - event layers, functions and macros. */
export function collectBlueprintDocumentUsage(document: BlueprintDocument, types: TypeOwnership): DependencyUsageRecord[] {
    const usage: DependencyUsageRecord[] = [];
    for (const blueprint of Object.values(document.blueprints)) {
        const { events, functions, macros } = blueprint.graphs;
        for (const group of [events, functions, macros]) {
            if (!group) {
                continue;
            }
            for (const entry of Object.values(group)) {
                const nodes = entry.graph?.nodes;
                if (!nodes) {
                    continue;
                }
                for (const node of Object.values(nodes)) {
                    const record = attributeType(node.type, "blueprintNode", types);
                    if (record) {
                        usage.push(record);
                    }
                }
            }
        }
    }
    return usage;
}

/** Plugin widgets placed on any page or inside any component definition. */
export function collectInterfaceDocumentUsage(document: InterfaceDocumentElements, types: TypeOwnership): DependencyUsageRecord[] {
    const usage: DependencyUsageRecord[] = [];
    const collect = (elements: Record<string, { type: string }>): void => {
        for (const element of Object.values(elements)) {
            const record = attributeType(element.type, "widget", types);
            if (record) {
                usage.push(record);
            }
        }
    };
    collect(document.elements);
    for (const component of document.components ?? []) {
        collect(component.elements);
    }
    return usage;
}

function toInstalledPlugin(plugin: PluginListItem): InstalledPlugin {
    return {
        id: plugin.pluginId,
        version: plugin.manifest.version,
        enabled: plugin.enabled,
        builtIn: plugin.builtIn,
        name: plugin.manifest.name,
        publisher: plugin.manifest.publisher,
    };
}

/**
 * Which of each installed plugin's storage namespaces travel into the game.
 *
 * Read from the manifest rather than remembered in the table: what a plugin publishes is a fact
 * about the version installed now, and a namespace it stopped publishing must stop making the
 * project depend on it.
 */
function listPublishedNamespaces(plugins: readonly PluginListItem[]): Map<string, ReadonlySet<string>> {
    const published = new Map<string, ReadonlySet<string>>();
    for (const plugin of plugins) {
        published.set(plugin.pluginId, new Set(plugin.manifest.contributes?.runtimeData ?? []));
    }
    return published;
}

/**
 * Merge freshly scanned plugin usage with the project's existing dependency table. Pure so the
 * merge policy can be unit-tested independent of the workspace.
 *
 * **A plugin has a row exactly while something in the project refers to it.** The scan sees every
 * reference whether or not the plugin is loaded (see {@link DependencyScanInput.usage}), so a row
 * whose plugin nothing refers to any more is dropped - a plugin that is absent or switched off
 * included, since its types would still be in the documents if anything used it. The one time a
 * row outlives its evidence is a scan that could not read every document.
 *
 * What a row says:
 * - **version** - for a plugin Studio holds back from the project (see {@link isHeldBack}), the
 *   recorded one, until the author's Rescan records the installed one and so releases the hold. A
 *   held plugin is the one case where the project's own rows cannot speak for the version: its
 *   stores and story rows are still there to be found, and recording the installed version on
 *   their evidence released the hold on the next run, with the notice still telling the author the
 *   hold would last until they acted. Otherwise, the installed one, when the scan saw the project
 *   use the plugin through a loaded type, a story row or a store. A plugin known only by the names
 *   of its types is not loaded here - absent or switched off - so nothing has been made with the
 *   installed one, and the recorded version stands.
 * - **hard** - from the references found. A store's weight is read off the installed manifest, so
 *   with no plugin installed, or a document unread, the recorded answer is kept as well.
 * - **usedBy** - what the scan found, plus what was recorded if the scan was incomplete.
 */
export function buildDependencyTable(input: DependencyScanInput): ProjectDependencyTable {
    const { usage, installed, existing, complete } = input;
    const releaseHolds = input.trigger === "rescan";
    const installedById = new Map(installed.map(plugin => [plugin.id, plugin] as const));
    const existingById = new Map((existing?.plugins ?? []).map(plugin => [plugin.id, plugin] as const));
    // The recorded version, unless the author's Rescan is releasing the hold on it.
    const heldVersion = (prior: ProjectPluginDependency | undefined, info: InstalledPlugin | undefined): string | null => {
        if (!prior || !info || !isHeldBack(prior, info.version)) {
            return null;
        }
        return releaseHolds ? info.version : prior.authoredVersion;
    };

    // Fold usage records into one accumulator per plugin.
    const accumulators = new Map<string, {
        hard: boolean;
        byNameOnly: boolean;
        usedBy: Map<DependencyKind, Set<string>>;
    }>();
    for (const record of usage) {
        let accumulator = accumulators.get(record.pluginId);
        if (!accumulator) {
            accumulator = { hard: false, byNameOnly: true, usedBy: new Map() };
            accumulators.set(record.pluginId, accumulator);
        }
        accumulator.hard = accumulator.hard || record.hard;
        accumulator.byNameOnly = accumulator.byNameOnly && record.byName === true;
        addUse(accumulator.usedBy, record.kind, record.id);
    }

    const merged = new Map<string, ProjectPluginDependency>();
    for (const [pluginId, accumulator] of accumulators) {
        const info = installedById.get(pluginId);
        const prior = existingById.get(pluginId);
        const name = info?.name ?? prior?.name;
        const publisher = info?.publisher ?? prior?.publisher;
        const authoredVersion = heldVersion(prior, info) ?? (accumulator.byNameOnly
            ? prior?.authoredVersion ?? info?.version ?? "0.0.0"
            : info?.version ?? prior?.authoredVersion ?? "0.0.0");
        const usedBy = accumulator.usedBy;
        if (!complete) {
            for (const [kind, ids] of Object.entries(prior?.usedBy ?? {}) as [DependencyKind, string[]][]) {
                for (const id of ids) {
                    addUse(usedBy, kind, id);
                }
            }
        }
        merged.set(pluginId, {
            id: pluginId,
            builtIn: info?.builtIn ?? prior?.builtIn ?? false,
            authoredVersion,
            hard: accumulator.hard || (prior?.hard === true && (!info || !complete)),
            ...(name ? { name } : {}),
            ...(publisher ? { publisher } : {}),
            usedBy: toUsedBy(usedBy),
        });
    }

    if (!complete) {
        // Kept for want of evidence either way, but the author's Rescan still speaks for its version:
        // a hold that Rescan left in place because some story would not load is one the author has
        // no way to release.
        for (const prior of existing?.plugins ?? []) {
            if (!merged.has(prior.id)) {
                const version = heldVersion(prior, installedById.get(prior.id));
                merged.set(prior.id, version === null ? prior : { ...prior, authoredVersion: version });
            }
        }
    }

    const plugins = Array.from(merged.values()).sort((a, b) => a.id.localeCompare(b.id));
    return { schemaVersion: PROJECT_DEPENDENCY_SCHEMA_VERSION, plugins };
}

function addUse(usedBy: Map<DependencyKind, Set<string>>, kind: DependencyKind, id: string): void {
    let set = usedBy.get(kind);
    if (!set) {
        set = new Set();
        usedBy.set(kind, set);
    }
    set.add(id);
}

function toUsedBy(usedBy: Map<DependencyKind, Set<string>>): Partial<Record<DependencyKind, string[]>> {
    const result: Partial<Record<DependencyKind, string[]>> = {};
    for (const [kind, set] of usedBy) {
        if (set.size > 0) {
            result[kind] = Array.from(set).sort();
        }
    }
    return result;
}
