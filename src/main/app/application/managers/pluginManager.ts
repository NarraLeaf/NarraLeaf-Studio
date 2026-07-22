import fs from "fs/promises";
import path from "path";
import { UserDataNamespace, AppHost, AppProtocol } from "@shared/types/constants";
import type { PluginPermissionGrantResult, PluginPermissionRequest } from "@shared/types/pluginPermissions";
import {
    type NormalizedPluginManifestV2,
    type PluginApproveResult,
    type PluginInstallRecord,
    type PluginInstallResult,
    type PluginInstallSource,
    type PluginListItem,
    type RuntimePluginDescriptor,
    type WorkspacePluginDescriptor,
} from "@shared/types/plugins";
import { PersistentState } from "@shared/utils/persistentState";
import type { PersistentStateConfig } from "@shared/types/persistentState";
import { validatePluginManifest } from "@shared/utils/pluginManifest";
import { flattenCatalog, type LocaleContribution } from "@shared/i18n";
import { PluginPermissionManager } from "./pluginPermissionManager";

interface PluginRegistryState extends Record<string, any> {
    "plugin.records": Record<string, PluginInstallRecord>;
}

type PluginManagerOptions = {
    builtInPluginsDir?: string;
};

type BuiltInPluginSource = {
    sourcePath: string;
    manifest: NormalizedPluginManifestV2;
};

const DEFAULT_STATE: PluginRegistryState = {
    "plugin.records": {},
};

export class PluginManager {
    private readonly state: PersistentState<PluginRegistryState>;
    private readonly pluginsDir: string;
    private initialized: Promise<void> | null = null;

    constructor(
        private readonly userDataDir: string,
        private readonly permissionManager: PluginPermissionManager,
        private readonly options: PluginManagerOptions = {},
    ) {
        this.pluginsDir = path.join(userDataDir, UserDataNamespace.Plugins);
        const dbPath = path.join(this.pluginsDir, "plugin-registry.config");
        const config: PersistentStateConfig<PluginRegistryState> = {
            dbPath,
            defaults: DEFAULT_STATE,
        };
        this.state = new PersistentState(config);
    }

    public initialize(): Promise<void> {
        if (!this.initialized) {
            this.initialized = this.scanInstalledPlugins();
        }
        return this.initialized;
    }

    public async listPlugins(): Promise<PluginListItem[]> {
        await this.initialize();
        return Object.values(this.getRecords()).map(record => this.toListItem(record));
    }

    public async listWorkspacePlugins(): Promise<WorkspacePluginDescriptor[]> {
        return this.listTargetPlugins("studio");
    }

    public async listRuntimePlugins(): Promise<RuntimePluginDescriptor[]> {
        return this.listTargetPlugins("runtime");
    }

    /**
     * Enabled plugins with a runtime entry, resolved to the absolute entry
     * file inside the install directory. Used by the game pack compiler to
     * copy plugin runtime code into preview/production artifacts.
     */
    public async listRuntimePluginPackSources(): Promise<Array<{
        manifest: NormalizedPluginManifestV2;
        entry: string;
        entryPath: string;
    }>> {
        await this.initialize();
        return Object.values(this.getRecords())
            .filter(record => this.toListItem(record).status === "enabled" && record.manifest.entries.runtime)
            .map(record => {
                const entry = record.manifest.entries.runtime!.replace(/\\/g, "/");
                return {
                    manifest: record.manifest,
                    entry,
                    entryPath: path.resolve(record.installPath, ...entry.split("/")),
                };
            });
    }

    /**
     * Studio language-pack contributions from every enabled plugin, with each
     * declared JSON catalog read from disk and flattened to `dotted.key ->
     * string`. Malformed catalogs are skipped with a warning rather than
     * crashing. Fed into the shared locale registry (main + every renderer) so a
     * plugin locale becomes a first-class locale app-wide.
     */
    public async listLocaleContributions(): Promise<LocaleContribution[]> {
        await this.initialize();
        const out: LocaleContribution[] = [];
        for (const record of Object.values(this.getRecords())) {
            if (this.toListItem(record).status !== "enabled") {
                continue;
            }
            const locales = record.manifest.contributes.locales;
            if (!locales || locales.length === 0) {
                continue;
            }
            const root = path.resolve(record.installPath);
            for (const entry of locales) {
                try {
                    const filePath = path.resolve(record.installPath, ...entry.messages.split(/[\\/]+/));
                    if (!this.isSameOrChild(filePath, root)) {
                        console.warn(`[PluginManager] locale "${entry.code}" for ${record.manifest.id} escapes the package; skipped`);
                        continue;
                    }
                    const parsed = JSON.parse(await fs.readFile(filePath, "utf-8"));
                    const flat = flattenCatalog(parsed);
                    if (flat.size === 0) {
                        continue;
                    }
                    out.push({
                        pluginId: record.manifest.id,
                        code: entry.code,
                        meta: {
                            nativeName: entry.nativeName,
                            englishName: entry.englishName,
                            intl: entry.intl,
                            dir: entry.dir,
                        },
                        messages: Object.fromEntries(flat),
                    });
                } catch (error) {
                    console.warn(`[PluginManager] failed to read locale "${entry.code}" for ${record.manifest.id}:`, error);
                }
            }
        }
        return out;
    }

    private async listTargetPlugins(target: "studio" | "runtime"): Promise<WorkspacePluginDescriptor[]> {
        const plugins = await this.listPlugins();
        return plugins
            .filter(plugin => plugin.status === "enabled" && plugin.manifest.entries[target])
            .map(plugin => ({
                plugin: {
                    id: plugin.manifest.id,
                    name: plugin.manifest.name,
                    version: plugin.manifest.version,
                    publisher: plugin.manifest.publisher,
                },
                manifest: plugin.manifest,
                entryUrl: this.getPluginEntryUrl(plugin.manifest, plugin.manifest.entries[target]!),
            }));
    }

    public async installFromDirectory(
        sourceDir: string,
        sourceOverride?: PluginInstallSource,
    ): Promise<PluginInstallResult> {
        await this.initialize();
        const sourceManifest = await this.readManifest(sourceDir);
        const installPath = this.getInstallPath(sourceManifest.id);
        const existing = this.getRecords()[sourceManifest.id];
        if (existing?.builtIn) {
            throw new Error("Built-in plugins cannot be replaced");
        }

        await fs.mkdir(this.pluginsDir, { recursive: true });
        const samePath = path.resolve(sourceDir) === path.resolve(installPath);
        if (!samePath) {
            const tempPath = `${installPath}.tmp-${Date.now()}`;
            await fs.rm(tempPath, { recursive: true, force: true });
            await fs.cp(sourceDir, tempPath, { recursive: true });
            await fs.rm(installPath, { recursive: true, force: true });
            await fs.rename(tempPath, installPath);
        }

        const manifest = samePath ? sourceManifest : await this.readManifest(installPath);
        const now = Date.now();
        const record: PluginInstallRecord = {
            pluginId: manifest.id,
            installPath,
            enabled: existing?.enabled ?? false,
            builtIn: false,
            manifest,
            installSource: sourceOverride ?? { kind: "local-directory", path: sourceDir },
            installedAt: existing?.installedAt ?? now,
            updatedAt: now,
            grantedManifestVersion: existing?.grantedManifestVersion === manifest.version
                ? existing.grantedManifestVersion
                : null,
            lastError: null,
        };

        this.saveRecord(record);
        return { canceled: false, plugin: this.toListItem(record) };
    }

    public async setPluginEnabled(pluginId: string, enabled: boolean): Promise<PluginListItem> {
        await this.initialize();
        const record = this.getRecord(pluginId);
        if (enabled && this.needsAuthorization(record)) {
            throw new Error("Plugin needs authorization before it can be enabled");
        }
        const next = { ...record, enabled, updatedAt: Date.now(), lastError: enabled ? null : record.lastError };
        this.saveRecord(next);
        return this.toListItem(next);
    }

    public async approvePlugin(pluginId: string, grant: PluginPermissionGrantResult | null): Promise<PluginApproveResult> {
        await this.initialize();
        const record = this.getRecord(pluginId);
        if (!grant?.approved) {
            return { plugin: this.toListItem(record), approved: false };
        }

        const next = {
            ...record,
            enabled: true,
            grantedManifestVersion: record.manifest.version,
            updatedAt: Date.now(),
            lastError: null,
        };
        this.saveRecord(next);
        return { plugin: this.toListItem(next), approved: true };
    }

    public async uninstallPlugin(pluginId: string): Promise<void> {
        await this.initialize();
        const record = this.getRecord(pluginId);
        if (record.builtIn) {
            throw new Error("Built-in plugins cannot be uninstalled");
        }
        await fs.rm(record.installPath, { recursive: true, force: true });
        const records = this.getRecords();
        delete records[pluginId];
        this.setRecords(records);
        this.permissionManager.revokePluginPermissions(pluginId);
    }

    public async revokePlugin(pluginId: string): Promise<PluginListItem> {
        await this.initialize();
        const record = this.getRecord(pluginId);
        this.permissionManager.revokePluginPermissions(pluginId);
        const next = {
            ...record,
            enabled: false,
            grantedManifestVersion: null,
            updatedAt: Date.now(),
        };
        this.saveRecord(next);
        return this.toListItem(next);
    }

    public async reportLoadError(pluginId: string, error: string | null): Promise<PluginListItem> {
        await this.initialize();
        const record = this.getRecord(pluginId);
        const next = {
            ...record,
            lastError: error,
            updatedAt: Date.now(),
        };
        this.saveRecord(next);
        return this.toListItem(next);
    }

    public async buildInstallRequest(pluginId: string): Promise<PluginPermissionRequest> {
        await this.initialize();
        const record = this.getRecord(pluginId);
        const requestId = `plugin-install:${pluginId}:${record.manifest.version}:${Date.now()}`;
        return {
            kind: "install",
            requestId,
            plugin: {
                id: record.manifest.id,
                name: record.manifest.name,
                version: record.manifest.version,
                publisher: record.manifest.publisher,
            },
            source: this.formatInstallSource(record.installSource),
            permissions: record.manifest.permissions,
            persistence: "permanent",
            reason: "Approve the permissions declared by this plugin manifest.",
            requestedAt: Date.now(),
        };
    }

    public async resolvePluginEntryFile(url: URL): Promise<string | null> {
        await this.initialize();
        const segments = url.pathname.split("/").filter(Boolean).map(segment => decodeURIComponent(segment));
        if (segments.length < 3) {
            return null;
        }
        const [pluginId, version, ...entrySegments] = segments;
        const record = this.getRecords()[pluginId];
        if (!record || this.toListItem(record).status !== "enabled" || record.manifest.version !== version) {
            return null;
        }
        const requestedEntry = entrySegments.join("/");
        const declaredEntries = [record.manifest.entries.studio, record.manifest.entries.runtime]
            .filter((entry): entry is string => Boolean(entry))
            .map(entry => entry.replace(/\\/g, "/"));
        if (!declaredEntries.includes(requestedEntry)) {
            return null;
        }
        const target = path.resolve(record.installPath, ...entrySegments);
        const root = path.resolve(record.installPath);
        if (!this.isSameOrChild(target, root)) {
            return null;
        }
        return target;
    }

    private async scanInstalledPlugins(): Promise<void> {
        await fs.mkdir(this.pluginsDir, { recursive: true });
        const records = this.getRecords();
        const builtInSources = await this.syncBuiltInPlugins(records);
        const nextRecords: Record<string, PluginInstallRecord> = {};
        const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
        const now = Date.now();

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const installPath = path.join(this.pluginsDir, entry.name);
            const existing = Object.values(records).find(record => path.resolve(record.installPath) === path.resolve(installPath));
            try {
                const manifest = await this.readManifest(installPath);
                const builtInSource = builtInSources.get(manifest.id);
                const previous = records[manifest.id] ?? existing;
                const builtIn = Boolean(builtInSource) || previous?.builtIn === true;
                const grantedManifestVersion = builtIn
                    ? manifest.version
                    : previous?.grantedManifestVersion === manifest.version
                    ? previous.grantedManifestVersion
                    : null;
                nextRecords[manifest.id] = {
                    pluginId: manifest.id,
                    installPath,
                    enabled: builtIn ? previous?.enabled ?? true : previous?.enabled ?? false,
                    builtIn,
                    manifest,
                    installSource: builtIn && builtInSource
                        ? { kind: "builtin", path: builtInSource.sourcePath }
                        : previous?.installSource ?? { kind: "local-directory", path: installPath },
                    installedAt: previous?.installedAt ?? now,
                    updatedAt: previous?.updatedAt ?? now,
                    grantedManifestVersion,
                    lastError: builtIn ? null : previous?.lastError ?? null,
                };
            } catch (error) {
                if (existing) {
                    nextRecords[existing.pluginId] = {
                        ...existing,
                        enabled: false,
                        lastError: error instanceof Error ? error.message : String(error),
                    };
                }
            }
        }

        this.setRecords(nextRecords);
    }

    private async syncBuiltInPlugins(
        records: Record<string, PluginInstallRecord>,
    ): Promise<Map<string, BuiltInPluginSource>> {
        const builtInPluginsDir = this.options.builtInPluginsDir;
        const builtInSources = new Map<string, BuiltInPluginSource>();
        if (!builtInPluginsDir) {
            return builtInSources;
        }

        let entries: import("fs").Dirent[];
        try {
            entries = await fs.readdir(builtInPluginsDir, { withFileTypes: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
            return builtInSources;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const sourcePath = path.join(builtInPluginsDir, entry.name);
            try {
                const manifest = await this.readManifest(sourcePath);
                const installPath = this.getInstallPath(manifest.id);
                await this.replacePluginDirectory(sourcePath, installPath);
                builtInSources.set(manifest.id, { sourcePath, manifest });

                const previous = records[manifest.id];
                if (previous?.grantedManifestVersion !== manifest.version) {
                    this.grantBuiltInManifestPermissions(manifest, sourcePath);
                }
            } catch (error) {
                // Keep Studio start-up resilient: one broken built-in plugin should not break the app.
                console.error(`[PluginManager] Failed to sync built-in plugin from ${sourcePath}:`, error);
            }
        }

        return builtInSources;
    }

    private async replacePluginDirectory(sourcePath: string, installPath: string): Promise<void> {
        await fs.mkdir(this.pluginsDir, { recursive: true });
        const tempPath = `${installPath}.builtin-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await fs.rm(tempPath, { recursive: true, force: true });
        await this.copyDirectoryFromAsar(sourcePath, tempPath);
        await fs.rm(installPath, { recursive: true, force: true });
        await fs.rename(tempPath, installPath);
    }

    /**
     * Recursively copy a plugin package out of the built-in plugins directory.
     *
     * When Studio is packaged the source lives inside app.asar. Electron's asar
     * shim patches `readdir`/`readFile` to work transparently on the virtual
     * archive, but it does NOT patch directory streaming (`opendir`), which is
     * what `fs.cp({ recursive: true })` relies on - so `fs.cp` fails with
     * `ENOTDIR` on asar-packed built-in plugins. Walking the tree with
     * `readdir` + `readFile`/`writeFile` keeps the copy asar-safe in both the
     * packaged and unpacked (dev) layouts.
     */
    private async copyDirectoryFromAsar(sourceDir: string, destDir: string): Promise<void> {
        await fs.mkdir(destDir, { recursive: true });
        const entries = await fs.readdir(sourceDir, { withFileTypes: true });
        for (const entry of entries) {
            const sourceEntry = path.join(sourceDir, entry.name);
            const destEntry = path.join(destDir, entry.name);
            if (entry.isDirectory()) {
                await this.copyDirectoryFromAsar(sourceEntry, destEntry);
            } else if (entry.isFile()) {
                await fs.writeFile(destEntry, await fs.readFile(sourceEntry));
            }
            // Plugin packages contain only regular files and directories; other
            // entry types (symlinks, sockets) are intentionally skipped.
        }
    }

    private grantBuiltInManifestPermissions(
        manifest: NormalizedPluginManifestV2,
        sourcePath: string,
    ): void {
        const requestId = `builtin-install:${manifest.id}:${manifest.version}`;
        this.permissionManager.grantPermission({
            kind: "install",
            requestId,
            plugin: {
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                publisher: manifest.publisher,
            },
            source: `builtin:${sourcePath}`,
            permissions: manifest.permissions,
            persistence: "permanent",
            reason: "Built-in Studio plugin permissions.",
            requestedAt: Date.now(),
        }, {
            requestId,
            approved: true,
            persistence: "permanent",
        });
    }

    private async readManifest(pluginDir: string): Promise<NormalizedPluginManifestV2> {
        const manifestPath = path.join(pluginDir, "manifest.json");
        const raw = await fs.readFile(manifestPath, "utf-8");
        const parsed = JSON.parse(raw);
        const result = validatePluginManifest(parsed);
        if (!result.ok) {
            throw new Error(result.error);
        }
        const root = path.resolve(pluginDir);
        for (const [target, entry] of Object.entries(result.manifest.entries)) {
            if (!entry) {
                continue;
            }
            const entryPath = path.resolve(pluginDir, ...entry.split(/[\\/]+/));
            if (!this.isSameOrChild(entryPath, root)) {
                throw new Error(`Plugin ${target} entry must stay inside the plugin package`);
            }
            const entryStat = await fs.stat(entryPath).catch(() => null);
            if (!entryStat?.isFile()) {
                throw new Error(`Plugin ${target} entry file not found: ${entry}`);
            }
        }
        return result.manifest;
    }

    private getPluginEntryUrl(manifest: NormalizedPluginManifestV2, entry: string): string {
        const encodedEntry = entry
            .split(/[\\/]+/)
            .map(segment => encodeURIComponent(segment))
            .join("/");
        return `${AppProtocol}://${AppHost.Plugins}/${encodeURIComponent(manifest.id)}/${encodeURIComponent(manifest.version)}/${encodedEntry}`;
    }

    private getInstallPath(pluginId: string): string {
        return path.join(this.pluginsDir, pluginId);
    }

    private getRecord(pluginId: string): PluginInstallRecord {
        const record = this.getRecords()[pluginId];
        if (!record) {
            throw new Error(`Plugin is not installed: ${pluginId}`);
        }
        return record;
    }

    private getRecords(): Record<string, PluginInstallRecord> {
        return { ...this.state.getItem("plugin.records") };
    }

    private setRecords(records: Record<string, PluginInstallRecord>): void {
        this.state.setItem("plugin.records", records);
    }

    private saveRecord(record: PluginInstallRecord): void {
        const records = this.getRecords();
        records[record.pluginId] = record;
        this.setRecords(records);
    }

    private toListItem(record: PluginInstallRecord): PluginListItem {
        const status = record.lastError
            ? "error"
            : this.needsAuthorization(record)
              ? "needsAuthorization"
              : record.enabled
                ? "enabled"
                : "disabled";
        return {
            pluginId: record.pluginId,
            manifest: record.manifest,
            installPath: record.installPath,
            enabled: record.enabled,
            builtIn: record.builtIn,
            status,
            installSource: record.installSource,
            installedAt: record.installedAt,
            updatedAt: record.updatedAt,
            grantedManifestVersion: record.grantedManifestVersion,
            lastError: record.lastError,
        };
    }

    private needsAuthorization(record: PluginInstallRecord): boolean {
        return record.grantedManifestVersion !== record.manifest.version;
    }

    private formatInstallSource(source: PluginInstallSource): string {
        switch (source.kind) {
            case "builtin":
                return `builtin:${source.path}`;
            case "registry":
                return source.url;
            default:
                return source.path;
        }
    }

    private isSameOrChild(target: string, root: string): boolean {
        const relativePath = path.relative(root, target);
        return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
    }
}
