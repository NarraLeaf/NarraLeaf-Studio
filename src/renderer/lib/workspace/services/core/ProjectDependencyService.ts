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
import { resolveDependencies } from "@shared/utils/resolveDependencies";
import { parsePluginStoreOwner } from "@shared/utils/pluginStorage";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { IProjectDependencyService, Services, WorkspaceContext } from "../services";
import { ProjectService } from "./ProjectService";
import { FileSystemService } from "./FileSystem";
import { BlueprintNodeCatalogService } from "../ui-editor/BlueprintNodeCatalogService";
import { LocalBlueprintService } from "../ui-editor/LocalBlueprintService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIGraphService } from "../ui-editor/UIGraphService";

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
}

export interface DependencyScanInput {
    usage: DependencyUsageRecord[];
    /**
     * Plugin ids currently loaded and contributing at least one type. For these,
     * `usage` is authoritative and recorded entries are re-derived (dropped when
     * unused); recorded entries for any other plugin are preserved.
     */
    authoritativePluginIds: Iterable<string>;
    installed: InstalledPlugin[];
    existing?: ProjectDependencyTable;
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
        // before plugins load. Scanning is deferred to save/export/manual - it
        // needs loaded plugins to attribute usage, which the persisted table
        // already captured. A failure here must not block opening the project.
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
     */
    public async previewResolve(): Promise<ProjectDependencyResolution> {
        return this.computeResolution(await this.rescan());
    }

    private async computeResolution(table: ProjectDependencyTable): Promise<ProjectDependencyResolution> {
        return resolveDependencies(table, await this.listInstalledPlugins());
    }

    /**
     * Scan the project for plugin usage and produce an up-to-date table. Merges
     * with the existing table (see {@link buildDependencyTable}).
     */
    public async rescan(): Promise<ProjectDependencyTable> {
        const ctx = this.getContext();
        // Load documents defensively so a manual rescan works even if a document
        // has not been opened yet in this session.
        try {
            await ctx.services.get<UIGraphService>(Services.UIGraph).load();
        } catch { /* fall through - collectors tolerate an unloaded doc */ }
        try {
            await ctx.services.get<UIDocumentService>(Services.UIDocument).load();
        } catch { /* fall through */ }

        const usage: DependencyUsageRecord[] = [];
        const authoritative = new Set<string>();
        this.collectBlueprintNodeUsage(usage, authoritative);
        this.collectWidgetUsage(usage, authoritative);
        await this.collectStorageUsage(usage);
        // Story-action usage is added once plugin story actions become a real,
        // referenceable extension point (registration + story-doc reference model).

        return buildDependencyTable({
            usage,
            authoritativePluginIds: authoritative,
            installed: await this.listInstalledPlugins(),
            existing: this.getProjectService().getDependencyTable(),
        });
    }

    /** Scan, persist the fresh table into the manifest, then re-resolve. */
    public async rescanAndPersist(): Promise<ProjectDependencyResolution> {
        const table = await this.rescan();
        await this.getProjectService().setDependencyTable(table);
        return this.resolve();
    }

    private collectBlueprintNodeUsage(usage: DependencyUsageRecord[], authoritative: Set<string>): void {
        const ctx = this.getContext();
        const catalog = ctx.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);
        for (const pluginId of catalog.getContributingPluginIds()) {
            authoritative.add(pluginId);
        }

        let document;
        try {
            document = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint).getBlueprintDocument();
        } catch {
            return;
        }

        for (const blueprint of Object.values(document.blueprints)) {
            if (blueprint.program?.kind !== "graph") {
                continue;
            }
            const { events, functions, macros } = blueprint.program.graphs;
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
                        const owner = catalog.getNodeOwner(node.type);
                        if (owner) {
                            usage.push({ pluginId: owner, kind: "blueprintNode", id: node.type, hard: true });
                        }
                    }
                }
            }
        }
    }

    private collectWidgetUsage(usage: DependencyUsageRecord[], authoritative: Set<string>): void {
        for (const pluginId of widgetModuleRegistry.getOwnerPluginIds()) {
            authoritative.add(pluginId);
        }

        let document;
        try {
            document = this.getContext().services.get<UIDocumentService>(Services.UIDocument).getDocument();
        } catch {
            return;
        }

        const collect = (elements: Record<string, { type: string }>): void => {
            for (const element of Object.values(elements)) {
                const owner = widgetModuleRegistry.getOwner(element.type);
                if (owner) {
                    usage.push({ pluginId: owner, kind: "widget", id: element.type, hard: true });
                }
            }
        };

        collect(document.elements);
        for (const component of document.components ?? []) {
            collect(component.elements);
        }
    }

    /**
     * Soft dependencies: plugins that have written project storage. Attributable
     * from the store filename on disk (see {@link parsePluginStoreOwner}), so it
     * works even when the owning plugin is not installed. Not marked
     * authoritative - a data-only store never breaks the document, so it must not
     * cause a hard dependency for the same plugin to be pruned.
     */
    private async collectStorageUsage(usage: DependencyUsageRecord[]): Promise<void> {
        const ctx = this.getContext();
        const servicesDir = ctx.project.resolve(ProjectNameConvention.EditorServices);
        const listed = await ctx.services.get<FileSystemService>(Services.FileSystem).list(servicesDir);
        if (!listed.ok) {
            return; // the services directory may not exist yet
        }
        for (const entry of listed.data) {
            if (entry.type !== "file" || entry.ext !== ".json") {
                continue;
            }
            const owner = parsePluginStoreOwner(entry.name);
            if (owner) {
                usage.push({ pluginId: owner, kind: "storage", id: entry.name, hard: false });
            }
        }
    }

    private async listInstalledPlugins(): Promise<InstalledPlugin[]> {
        const result = await getInterface().plugins.list();
        if (!result.success || !result.data) {
            throw new Error(result.success ? "Plugin list response was empty" : (result.error ?? "Failed to list plugins"));
        }
        return result.data.plugins.map(plugin => ({
            id: plugin.pluginId,
            version: plugin.manifest.version,
            enabled: plugin.enabled,
            builtIn: plugin.builtIn,
            name: plugin.manifest.name,
            publisher: plugin.manifest.publisher,
        }));
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

/**
 * Merge freshly scanned plugin usage with the project's existing dependency
 * table. Pure so the merge policy can be unit-tested independent of the
 * workspace. Fresh usage for authoritative (loaded) plugins wins; recorded
 * entries for non-authoritative (absent/disabled) plugins are preserved.
 */
export function buildDependencyTable(input: DependencyScanInput): ProjectDependencyTable {
    const { usage, installed, existing } = input;
    const authoritative = new Set(input.authoritativePluginIds);
    const installedById = new Map(installed.map(plugin => [plugin.id, plugin] as const));
    const existingById = new Map((existing?.plugins ?? []).map(plugin => [plugin.id, plugin] as const));

    // Fold usage records into one accumulator per plugin.
    const accumulators = new Map<string, { hard: boolean; usedBy: Map<DependencyKind, Set<string>> }>();
    for (const record of usage) {
        let accumulator = accumulators.get(record.pluginId);
        if (!accumulator) {
            accumulator = { hard: false, usedBy: new Map() };
            accumulators.set(record.pluginId, accumulator);
        }
        accumulator.hard = accumulator.hard || record.hard;
        let set = accumulator.usedBy.get(record.kind);
        if (!set) {
            set = new Set();
            accumulator.usedBy.set(record.kind, set);
        }
        set.add(record.id);
    }

    const merged = new Map<string, ProjectPluginDependency>();
    for (const [pluginId, accumulator] of accumulators) {
        const info = installedById.get(pluginId);
        const prior = existingById.get(pluginId);
        const name = info?.name ?? prior?.name;
        const publisher = info?.publisher ?? prior?.publisher;
        merged.set(pluginId, {
            id: pluginId,
            builtIn: info?.builtIn ?? prior?.builtIn ?? false,
            authoredVersion: info?.version ?? prior?.authoredVersion ?? "0.0.0",
            hard: accumulator.hard,
            ...(name ? { name } : {}),
            ...(publisher ? { publisher } : {}),
            usedBy: toUsedBy(accumulator.usedBy),
        });
    }

    // Preserve recorded dependencies whose plugin we cannot currently attribute:
    // absent or disabled plugins are not authoritative, so dropping them would
    // lose a real dependency needed after export/import.
    for (const prior of existing?.plugins ?? []) {
        if (!merged.has(prior.id) && !authoritative.has(prior.id)) {
            merged.set(prior.id, prior);
        }
    }

    const plugins = Array.from(merged.values()).sort((a, b) => a.id.localeCompare(b.id));
    return { schemaVersion: PROJECT_DEPENDENCY_SCHEMA_VERSION, plugins };
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
