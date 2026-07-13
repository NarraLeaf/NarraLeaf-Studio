import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginManager } from "./pluginManager";

vi.mock("@shared/utils/persistentState", () => {
    const stores = new Map<string, Record<string, any>>();
    return {
        PersistentState: class<T extends Record<string, any>> {
            private readonly key: string;

            constructor(config: { dbPath: string; defaults: T }) {
                this.key = config.dbPath;
                if (!stores.has(this.key)) {
                    stores.set(this.key, JSON.parse(JSON.stringify(config.defaults)));
                }
            }

            getItem<K extends keyof T>(key: K): T[K] {
                return stores.get(this.key)![key as string] as T[K];
            }

            setItem<K extends keyof T>(key: K, value: T[K]): void {
                stores.get(this.key)![key as string] = value;
            }
        },
    };
});

describe("PluginManager", () => {
    let tempDir: string;
    let sourceDir: string;
    let permissionManager: {
        revokePluginPermissions: ReturnType<typeof vi.fn>;
        grantPermission: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-manager-"));
        sourceDir = path.join(tempDir, "source");
        permissionManager = {
            revokePluginPermissions: vi.fn(),
            grantPermission: vi.fn(() => ({
                requestId: "builtin-install",
                pluginId: "acme.sample-plugin",
                kind: "install",
                approved: true,
                persistence: "permanent",
                grantedAt: Date.now(),
            })),
        };
        await writePluginPackage(sourceDir, "1.0.0");
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("installs a local directory and keeps it disabled until authorization", async () => {
        const manager = new PluginManager(tempDir, permissionManager as any);
        const result = await manager.installFromDirectory(sourceDir);

        expect(result).toMatchObject({
            canceled: false,
            plugin: {
                pluginId: "acme.sample-plugin",
                status: "needsAuthorization",
                enabled: false,
            },
        });
        await expect(fs.stat(path.join(tempDir, "plugins", "acme.sample-plugin", "main.js"))).resolves.toBeTruthy();
        await expect(manager.listWorkspacePlugins()).resolves.toEqual([]);
    });

    it("returns enabled workspace descriptors and resolves only the declared entry file", async () => {
        const manager = new PluginManager(tempDir, permissionManager as any);
        await manager.installFromDirectory(sourceDir);
        await manager.approvePlugin("acme.sample-plugin", {
            requestId: "install",
            pluginId: "acme.sample-plugin",
            kind: "install",
            approved: true,
            persistence: "permanent",
        });

        const [descriptor] = await manager.listWorkspacePlugins();
        expect(descriptor).toMatchObject({
            plugin: {
                id: "acme.sample-plugin",
                version: "1.0.0",
            },
        });
        expect(descriptor.entryUrl).toContain("app://plugins/acme.sample-plugin/1.0.0/main.js");

        await expect(manager.resolvePluginEntryFile(new URL(descriptor.entryUrl))).resolves.toBe(
            path.join(tempDir, "plugins", "acme.sample-plugin", "main.js"),
        );
        await expect(manager.resolvePluginEntryFile(new URL("app://plugins/acme.sample-plugin/1.0.0/manifest.json"))).resolves.toBeNull();
    });

    it("lists runtime descriptors separately and resolves both declared entries", async () => {
        await writePluginPackage(sourceDir, "1.0.0", { studio: "main.js", runtime: "runtime.js" });
        const manager = new PluginManager(tempDir, permissionManager as any);
        await manager.installFromDirectory(sourceDir);
        await manager.approvePlugin("acme.sample-plugin", {
            requestId: "install",
            pluginId: "acme.sample-plugin",
            kind: "install",
            approved: true,
            persistence: "permanent",
        });

        const [workspaceDescriptor] = await manager.listWorkspacePlugins();
        expect(workspaceDescriptor.entryUrl).toContain("app://plugins/acme.sample-plugin/1.0.0/main.js");

        const [runtimeDescriptor] = await manager.listRuntimePlugins();
        expect(runtimeDescriptor.entryUrl).toContain("app://plugins/acme.sample-plugin/1.0.0/runtime.js");

        await expect(manager.resolvePluginEntryFile(new URL(runtimeDescriptor.entryUrl))).resolves.toBe(
            path.join(tempDir, "plugins", "acme.sample-plugin", "runtime.js"),
        );
    });

    it("excludes runtime-only plugins from the workspace list", async () => {
        await writePluginPackage(sourceDir, "1.0.0", { runtime: "runtime.js" });
        const manager = new PluginManager(tempDir, permissionManager as any);
        await manager.installFromDirectory(sourceDir);
        await manager.approvePlugin("acme.sample-plugin", {
            requestId: "install",
            pluginId: "acme.sample-plugin",
            kind: "install",
            approved: true,
            persistence: "permanent",
        });

        await expect(manager.listWorkspacePlugins()).resolves.toEqual([]);
        const runtimePlugins = await manager.listRuntimePlugins();
        expect(runtimePlugins).toHaveLength(1);
    });

    it("requires authorization again when the installed manifest version changes", async () => {
        const manager = new PluginManager(tempDir, permissionManager as any);
        await manager.installFromDirectory(sourceDir);
        await manager.approvePlugin("acme.sample-plugin", {
            requestId: "install",
            pluginId: "acme.sample-plugin",
            kind: "install",
            approved: true,
            persistence: "permanent",
        });

        await writePluginPackage(path.join(tempDir, "plugins", "acme.sample-plugin"), "1.1.0");
        const rescanned = new PluginManager(tempDir, permissionManager as any);
        const [plugin] = await rescanned.listPlugins();

        expect(plugin).toMatchObject({
            pluginId: "acme.sample-plugin",
            status: "needsAuthorization",
            grantedManifestVersion: null,
            manifest: {
                version: "1.1.0",
            },
        });
    });

    it("uninstalls local plugins and revokes saved permissions", async () => {
        const manager = new PluginManager(tempDir, permissionManager as any);
        await manager.installFromDirectory(sourceDir);

        await manager.uninstallPlugin("acme.sample-plugin");

        await expect(manager.listPlugins()).resolves.toEqual([]);
        expect(permissionManager.revokePluginPermissions).toHaveBeenCalledWith("acme.sample-plugin");
        await expect(fs.stat(path.join(tempDir, "plugins", "acme.sample-plugin"))).rejects.toBeTruthy();
    });

    it("syncs built-in plugins into the protected plugin registry and enables them", async () => {
        const builtInPluginsDir = path.join(tempDir, "dist", "builtin-plugins");
        await writePluginPackage(path.join(builtInPluginsDir, "sample"), "1.0.0");

        const manager = new PluginManager(tempDir, permissionManager as any, { builtInPluginsDir });
        const [plugin] = await manager.listPlugins();

        expect(plugin).toMatchObject({
            pluginId: "acme.sample-plugin",
            builtIn: true,
            enabled: true,
            status: "enabled",
            grantedManifestVersion: "1.0.0",
            installSource: {
                kind: "builtin",
                path: path.join(builtInPluginsDir, "sample"),
            },
        });
        await expect(fs.stat(path.join(tempDir, "plugins", "acme.sample-plugin", "main.js"))).resolves.toBeTruthy();
        expect(permissionManager.grantPermission).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "install",
                plugin: expect.objectContaining({ id: "acme.sample-plugin", version: "1.0.0" }),
                source: `builtin:${path.join(builtInPluginsDir, "sample")}`,
            }),
            expect.objectContaining({
                approved: true,
                persistence: "permanent",
            }),
        );
        await expect(manager.uninstallPlugin("acme.sample-plugin")).rejects.toThrow("Built-in plugins cannot be uninstalled");
    });
});

async function writePluginPackage(
    dir: string,
    version: string,
    entries: Record<string, string> = { studio: "main.js" },
): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    for (const entry of Object.values(entries)) {
        await fs.writeFile(path.join(dir, entry), "export default {};\n", "utf-8");
    }
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({
        manifestVersion: 2,
        id: "acme.sample-plugin",
        name: "Sample Plugin",
        version,
        description: "Test plugin",
        entries,
        permissions: [
            {
                kind: "api",
                capability: "bash.execute",
            },
        ],
    }), "utf-8");
}
