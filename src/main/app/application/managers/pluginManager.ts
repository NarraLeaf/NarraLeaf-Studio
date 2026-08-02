import fs from "fs/promises";
import path from "path";
import { UserDataNamespace, AppHost, AppProtocol } from "@shared/types/constants";
import type {
    PluginInstallPermission,
    PluginPermissionGrantResult,
    PluginPermissionRequest,
} from "@shared/types/pluginPermissions";
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
import { validatePluginIconBytes } from "@shared/utils/pluginIcon";
import { PLUGIN_ICON_MAX_BYTES } from "@shared/constants/pluginIcon";
import { isPermissionSubset } from "@shared/utils/pluginInstallPermissions";
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

/**
 * Where package swaps are assembled. It lives inside the plugins root (so the
 * final rename never crosses a volume) but is dot-prefixed, and the scan skips
 * dot-prefixed entries - a half-finished copy can therefore never be mistaken
 * for an installed package.
 */
const STAGING_DIR_NAME = ".staging";

/**
 * Names older builds staged next to the install path (`<id>.builtin-tmp-<ts>`,
 * `<id>.tmp-<ts>`, and the dev script's `<id>.builtin-dev-tmp-<ts>`). A swap
 * interrupted by a locked file left one behind for good, and because it carries
 * the *same* manifest id and sorts after the real directory, the scan built its
 * record from the leftover instead - pinning that plugin to a stale version on
 * every launch, rebuild after rebuild. They are garbage: recognise and delete.
 */
const LEGACY_STAGING_DIR = /\.(?:builtin-tmp|builtin-dev-tmp|tmp)-\d{13}(?:-[a-z0-9]+)?$/;

export class PluginManager {
    private readonly state: PersistentState<PluginRegistryState>;
    private readonly pluginsDir: string;
    /** Staged copies a swap is filling right now, so cleanup leaves them alone. */
    private readonly stagingInFlight = new Set<string>();
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

    /**
     * Re-sync the shipping built-in packages and rebuild the registry from disk.
     *
     * Start-up is the only other time this runs, which is fine for a packaged
     * app but not in development: `yarn dev` rebuilds built-in plugins into
     * `dist/builtin-plugins` while Studio is running, and without a re-sync the
     * app would keep serving the copy it took at launch until the next restart.
     */
    public async refreshBuiltInPlugins(): Promise<void> {
        const scan = this.initialize()
            .catch(() => undefined)
            .then(() => this.scanInstalledPlugins());
        // A failed refresh must not poison the memo - the records from the last
        // good scan stay serviceable, and the caller still sees the error.
        this.initialized = scan.catch(() => undefined);
        return scan;
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
        installPath: string;
    }>> {
        await this.initialize();
        return Object.values(this.getRecords())
            .filter(record => this.toListItem(record).status === "enabled" && record.manifest.entries.runtime)
            .map(record => {
                const entry = record.manifest.entries.runtime!.replace(/\\/g, "/");
                const installPath = path.resolve(record.installPath);
                return {
                    manifest: record.manifest,
                    entry,
                    entryPath: path.resolve(installPath, ...entry.split("/")),
                    // Sidecar `include` paths are package-relative, so the pack
                    // compiler needs the package root, not just the entry file.
                    installPath,
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
                entryUrl: this.getPluginFileUrl(plugin.manifest, plugin.manifest.entries[target]!),
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
            await this.swapPluginDirectory(installPath, staged => fs.cp(sourceDir, staged, { recursive: true }));
        }

        const manifest = samePath ? sourceManifest : await this.readManifest(installPath);
        const now = Date.now();
        // An update inherits the existing grant when it asks for no more than the
        // user already approved. Re-prompting on a version bump that widens
        // nothing is pure friction - the permission set is the security boundary,
        // not the version number.
        const granted = this.grantedPermissionsOf(existing);
        const inheritsGrant = granted !== null && isPermissionSubset(manifest.permissions, granted);
        const record: PluginInstallRecord = {
            pluginId: manifest.id,
            installPath,
            enabled: existing?.enabled ?? false,
            builtIn: false,
            manifest,
            installSource: sourceOverride ?? { kind: "local-directory", path: sourceDir },
            installedAt: existing?.installedAt ?? now,
            updatedAt: now,
            grantedManifestVersion: inheritsGrant ? manifest.version : null,
            grantedPermissions: inheritsGrant ? granted : null,
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
            // Declining leaves an unauthorized plugin, so it must not stay flagged
            // enabled: nothing loads it, and consumers that read `enabled`
            // directly (dependency resolution, the pack compiler) would otherwise
            // count a plugin that is not running.
            if (this.needsAuthorization(record) && record.enabled) {
                const disabled = { ...record, enabled: false, updatedAt: Date.now() };
                this.saveRecord(disabled);
                return { plugin: this.toListItem(disabled), approved: false };
            }
            return { plugin: this.toListItem(record), approved: false };
        }

        const next = {
            ...record,
            enabled: true,
            grantedManifestVersion: record.manifest.version,
            grantedPermissions: record.manifest.permissions,
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
            grantedPermissions: null,
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

    /**
     * The declared icon file behind an `app://plugins/<id>/<version>/<icon>`
     * request, or `null`.
     *
     * Unlike an entry, this deliberately does not require the plugin to be
     * enabled: the Launcher shows icons for disabled and not-yet-authorized
     * plugins too, and those rows are exactly where the user is deciding what
     * the plugin is. Serving a static image to Studio's own list is not a
     * capability the enable switch is there to gate.
     */
    public async resolvePluginIconFile(url: URL): Promise<string | null> {
        await this.initialize();
        const segments = url.pathname.split("/").filter(Boolean).map(segment => decodeURIComponent(segment));
        if (segments.length < 3) {
            return null;
        }
        const [pluginId, version, ...iconSegments] = segments;
        const record = this.getRecords()[pluginId];
        if (!record || record.manifest.version !== version) {
            return null;
        }
        const icon = record.manifest.icon?.replace(/\\/g, "/");
        if (!icon || iconSegments.join("/") !== icon) {
            return null;
        }
        const target = path.resolve(record.installPath, ...iconSegments);
        if (!this.isSameOrChild(target, path.resolve(record.installPath))) {
            return null;
        }
        return target;
    }

    private async scanInstalledPlugins(): Promise<void> {
        await fs.mkdir(this.pluginsDir, { recursive: true });
        await this.discardStagingLeftovers();
        const records = this.getRecords();
        const builtInSources = await this.syncBuiltInPlugins(records);
        const nextRecords: Record<string, PluginInstallRecord> = {};
        const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
        const now = Date.now();

        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith(".") || LEGACY_STAGING_DIR.test(entry.name)) {
                continue;
            }
            const installPath = path.join(this.pluginsDir, entry.name);
            const existing = Object.values(records).find(record => path.resolve(record.installPath) === path.resolve(installPath));
            try {
                const manifest = await this.readManifest(installPath);
                const builtInSource = builtInSources.get(manifest.id);
                const previous = records[manifest.id] ?? existing;
                const builtIn = Boolean(builtInSource) || previous?.builtIn === true;
                // A manifest that changed under us (built-in sync, a swapped
                // folder) keeps its grant only while it asks for no more than was
                // approved - the same rule installFromDirectory applies.
                const priorGrant = builtIn ? null : this.grantedPermissionsOf(previous);
                const inheritsGrant = priorGrant !== null && isPermissionSubset(manifest.permissions, priorGrant);
                const grantedManifestVersion = builtIn || inheritsGrant ? manifest.version : null;
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
                    grantedPermissions: builtIn
                        ? manifest.permissions
                        : inheritsGrant ? priorGrant : null,
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
        await this.swapPluginDirectory(installPath, staged => this.copyDirectoryFromAsar(sourcePath, staged));
    }

    /**
     * Replace a package directory by assembling the new copy under
     * `plugins/.staging` and renaming it into place.
     *
     * The staged copy used to sit *next to* the install path, which turned a
     * failed rename (a locked file, a crash mid-swap) into a permanent shadow:
     * the leftover declared the same plugin id, the scan read it like any other
     * package, and whichever of the two `readdir` returned last won. Staging out
     * of the scan's sight keeps a failure loud and local - the swap throws, the
     * caller logs it, and the previously installed package is what remains.
     */
    private async swapPluginDirectory(
        installPath: string,
        assemble: (stagedPath: string) => Promise<unknown>,
    ): Promise<void> {
        const stagingRoot = path.join(this.pluginsDir, STAGING_DIR_NAME);
        await fs.mkdir(stagingRoot, { recursive: true });
        const stagedPath = path.join(
            stagingRoot,
            `${path.basename(installPath)}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );
        this.stagingInFlight.add(stagedPath);
        try {
            await assemble(stagedPath);
            await fs.rm(installPath, { recursive: true, force: true });
            await fs.rename(stagedPath, installPath);
        } finally {
            this.stagingInFlight.delete(stagedPath);
            // A no-op once the rename lands; the point is the failure path.
            await fs.rm(stagedPath, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    /** Drop staged copies nobody is filling, plus any pre-fix sibling leftovers. */
    private async discardStagingLeftovers(): Promise<void> {
        const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const target = path.join(this.pluginsDir, entry.name);
            if (entry.name === STAGING_DIR_NAME) {
                for (const staged of await fs.readdir(target).catch(() => [])) {
                    const stagedPath = path.join(target, staged);
                    // An install running alongside this scan owns its staged copy.
                    if (!this.stagingInFlight.has(stagedPath)) {
                        await this.discard(stagedPath);
                    }
                }
            } else if (LEGACY_STAGING_DIR.test(entry.name)) {
                await this.discard(target);
            }
        }
    }

    private async discard(target: string): Promise<void> {
        await fs.rm(target, { recursive: true, force: true })
            .catch(error => console.warn(`[PluginManager] Failed to remove stale staging directory ${target}:`, error));
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
        if (result.manifest.icon) {
            await this.verifyIconFile(pluginDir, result.manifest.icon);
        }
        return result.manifest;
    }

    /**
     * Hold a declared icon to the shipping rules: inside the package, actually
     * an image of the format its name claims, square, and small.
     *
     * Failing the whole manifest is deliberate. The alternative — install, drop
     * the icon, show the monogram — produces a plugin that looks fine to the
     * user and wrong to its author, with nothing anywhere saying why.
     */
    private async verifyIconFile(pluginDir: string, icon: string): Promise<void> {
        const root = path.resolve(pluginDir);
        const iconPath = path.resolve(pluginDir, ...icon.split(/[\\/]+/));
        if (!this.isSameOrChild(iconPath, root)) {
            throw new Error("Plugin icon must stay inside the plugin package");
        }
        const stat = await fs.stat(iconPath).catch(() => null);
        if (!stat?.isFile()) {
            throw new Error(`Plugin icon file not found: ${icon}`);
        }
        // Checked before reading, so an oversized file is refused rather than
        // pulled into memory to be refused.
        if (stat.size > PLUGIN_ICON_MAX_BYTES) {
            throw new Error(`Plugin icon must be at most ${Math.floor(PLUGIN_ICON_MAX_BYTES / 1024)} KB`);
        }
        const error = validatePluginIconBytes(await fs.readFile(iconPath), icon);
        if (error) {
            throw new Error(error);
        }
    }

    private getPluginFileUrl(manifest: NormalizedPluginManifestV2, entry: string): string {
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
            ...(record.manifest.icon
                ? { iconUrl: this.getPluginFileUrl(record.manifest, record.manifest.icon) }
                : {}),
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

    /**
     * The permission set the user approved for this plugin, or `null` if there is
     * no grant to reason about. Records written before `grantedPermissions` was
     * tracked fall back to the manifest that was authorized — sound only while
     * that manifest is still the installed one, which `grantedManifestVersion`
     * proves.
     */
    private grantedPermissionsOf(record: PluginInstallRecord | undefined): PluginInstallPermission[] | null {
        if (!record || !record.grantedManifestVersion) {
            return null;
        }
        if (record.grantedPermissions) {
            return record.grantedPermissions;
        }
        return record.grantedManifestVersion === record.manifest.version
            ? record.manifest.permissions
            : null;
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
