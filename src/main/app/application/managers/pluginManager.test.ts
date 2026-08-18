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
    }
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
        grantedAt: Date.now()
      }))
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
        enabled: false
      }
    });
    await expect(
      fs.stat(path.join(tempDir, "plugins", "acme.sample-plugin", "main.js"))
    ).resolves.toBeTruthy();
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
      persistence: "permanent"
    });

    const [descriptor] = await manager.listWorkspacePlugins();
    expect(descriptor).toMatchObject({
      plugin: {
        id: "acme.sample-plugin",
        version: "1.0.0"
      }
    });
    expect(descriptor.entryUrl).toContain("app://plugins/acme.sample-plugin/1.0.0/main.js");

    await expect(manager.resolvePluginEntryFile(new URL(descriptor.entryUrl))).resolves.toBe(
      path.join(tempDir, "plugins", "acme.sample-plugin", "main.js")
    );
    await expect(
      manager.resolvePluginEntryFile(
        new URL("app://plugins/acme.sample-plugin/1.0.0/manifest.json")
      )
    ).resolves.toBeNull();
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
      persistence: "permanent"
    });

    const [workspaceDescriptor] = await manager.listWorkspacePlugins();
    expect(workspaceDescriptor.entryUrl).toContain(
      "app://plugins/acme.sample-plugin/1.0.0/main.js"
    );

    const [runtimeDescriptor] = await manager.listRuntimePlugins();
    expect(runtimeDescriptor.entryUrl).toContain(
      "app://plugins/acme.sample-plugin/1.0.0/runtime.js"
    );

    await expect(manager.resolvePluginEntryFile(new URL(runtimeDescriptor.entryUrl))).resolves.toBe(
      path.join(tempDir, "plugins", "acme.sample-plugin", "runtime.js")
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
      persistence: "permanent"
    });

    await expect(manager.listWorkspacePlugins()).resolves.toEqual([]);
    const runtimePlugins = await manager.listRuntimePlugins();
    expect(runtimePlugins).toHaveLength(1);
  });

  // The permission set is the security boundary, not the version string: an
  // update that asks for no more than was approved keeps running.
  it("keeps the grant when a new version does not widen permissions", async () => {
    const manager = new PluginManager(tempDir, permissionManager as any);
    await manager.installFromDirectory(sourceDir);
    await approve(manager);

    await writePluginPackage(path.join(tempDir, "plugins", "acme.sample-plugin"), "1.1.0");
    const rescanned = new PluginManager(tempDir, permissionManager as any);
    const [plugin] = await rescanned.listPlugins();

    expect(plugin).toMatchObject({
      pluginId: "acme.sample-plugin",
      status: "enabled",
      grantedManifestVersion: "1.1.0",
      manifest: { version: "1.1.0" }
    });
  });

  it("keeps the grant when a new version drops a permission", async () => {
    const manager = new PluginManager(tempDir, permissionManager as any);
    await manager.installFromDirectory(sourceDir);
    await approve(manager);

    await writePluginPackage(
      path.join(tempDir, "plugins", "acme.sample-plugin"),
      "1.1.0",
      undefined,
      []
    );
    const rescanned = new PluginManager(tempDir, permissionManager as any);
    const [plugin] = await rescanned.listPlugins();

    expect(plugin).toMatchObject({ status: "enabled", grantedManifestVersion: "1.1.0" });
  });

  it("requires authorization again when a new version widens permissions", async () => {
    const manager = new PluginManager(tempDir, permissionManager as any);
    await manager.installFromDirectory(sourceDir);
    await approve(manager);

    await writePluginPackage(
      path.join(tempDir, "plugins", "acme.sample-plugin"),
      "1.1.0",
      undefined,
      [
        { kind: "api", capability: "bash.execute" },
        { kind: "filesystem", path: "/", mode: "readwrite", recursive: true }
      ]
    );
    const rescanned = new PluginManager(tempDir, permissionManager as any);
    const [plugin] = await rescanned.listPlugins();

    expect(plugin).toMatchObject({
      pluginId: "acme.sample-plugin",
      status: "needsAuthorization",
      grantedManifestVersion: null,
      manifest: { version: "1.1.0" }
    });
  });

  it("installing a widened version over an approved one revokes the grant", async () => {
    const manager = new PluginManager(tempDir, permissionManager as any);
    await manager.installFromDirectory(sourceDir);
    await approve(manager);

    await writePluginPackage(sourceDir, "2.0.0", undefined, [
      { kind: "api", capability: "bash.execute" },
      { kind: "api", capability: "plugin.trust.grant" }
    ]);
    const result = await manager.installFromDirectory(sourceDir);

    expect(result.plugin).toMatchObject({
      status: "needsAuthorization",
      grantedManifestVersion: null
    });
  });

  // Declining leaves the plugin unauthorized; leaving `enabled` set would
  // report a plugin that nothing loads as running.
  it("disables a plugin whose re-authorization is declined", async () => {
    const manager = new PluginManager(tempDir, permissionManager as any);
    await manager.installFromDirectory(sourceDir);
    await approve(manager);

    await writePluginPackage(sourceDir, "2.0.0", undefined, [
      { kind: "api", capability: "bash.execute" },
      { kind: "api", capability: "plugin.trust.grant" }
    ]);
    await manager.installFromDirectory(sourceDir);
    const declined = await manager.approvePlugin("acme.sample-plugin", null);

    expect(declined.approved).toBe(false);
    expect(declined.plugin).toMatchObject({ enabled: false, status: "needsAuthorization" });
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
        path: path.join(builtInPluginsDir, "sample")
      }
    });
    await expect(
      fs.stat(path.join(tempDir, "plugins", "acme.sample-plugin", "main.js"))
    ).resolves.toBeTruthy();
    expect(permissionManager.grantPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "install",
        plugin: expect.objectContaining({ id: "acme.sample-plugin", version: "1.0.0" }),
        source: `builtin:${path.join(builtInPluginsDir, "sample")}`
      }),
      expect.objectContaining({
        approved: true,
        persistence: "permanent"
      })
    );
    await expect(manager.uninstallPlugin("acme.sample-plugin")).rejects.toThrow(
      "Built-in plugins cannot be uninstalled"
    );
  });

  it("ignores staging leftovers instead of letting them shadow the installed package", async () => {
    const builtInPluginsDir = path.join(tempDir, "dist", "builtin-plugins");
    await writePluginPackage(path.join(builtInPluginsDir, "sample"), "2.0.0");
    // What an interrupted swap used to leave behind: same manifest id, older
    // version, sorted after the real directory - so the scan built the record
    // from it and the plugin stayed pinned to 1.0.0 no matter how often it
    // was rebuilt.
    const leftover = path.join(
      tempDir,
      "plugins",
      "acme.sample-plugin.builtin-tmp-1785024220689-kookjitrca"
    );
    const staged = path.join(
      tempDir,
      "plugins",
      ".staging",
      "acme.sample-plugin-1785024220689-abc"
    );
    await writePluginPackage(leftover, "1.0.0");
    await writePluginPackage(staged, "0.9.0");

    const manager = new PluginManager(tempDir, permissionManager as any, { builtInPluginsDir });
    const plugins = await manager.listPlugins();

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      pluginId: "acme.sample-plugin",
      manifest: { version: "2.0.0" },
      builtIn: true,
      installPath: path.join(tempDir, "plugins", "acme.sample-plugin")
    });
    // Both leftovers are gone; the staging root itself is a working
    // directory and may survive, empty, between swaps.
    await expect(fs.stat(leftover)).rejects.toBeTruthy();
    await expect(fs.stat(staged)).rejects.toBeTruthy();
  });

  it("re-syncs built-in plugins that were rebuilt while Studio is running", async () => {
    const builtInPluginsDir = path.join(tempDir, "dist", "builtin-plugins");
    const packageDir = path.join(builtInPluginsDir, "sample");
    await writePluginPackage(packageDir, "1.0.0");

    const manager = new PluginManager(tempDir, permissionManager as any, { builtInPluginsDir });
    await expect(manager.listPlugins()).resolves.toMatchObject([
      { manifest: { version: "1.0.0" } }
    ]);

    // `yarn dev` rebuilding a built-in plugin under the running app.
    await writePluginPackage(packageDir, "1.1.0");
    await manager.refreshBuiltInPlugins();

    await expect(manager.listPlugins()).resolves.toMatchObject([
      {
        pluginId: "acme.sample-plugin",
        manifest: { version: "1.1.0" },
        enabled: true,
        grantedManifestVersion: "1.1.0"
      }
    ]);
    const installed = JSON.parse(
      await fs.readFile(
        path.join(tempDir, "plugins", "acme.sample-plugin", "manifest.json"),
        "utf-8"
      )
    );
    expect(installed.version).toBe("1.1.0");
  });

  it("exposes a declared icon and serves it before the plugin is authorized", async () => {
    await writeIcon(sourceDir, "icon.png", 512);
    await writePluginPackage(sourceDir, "1.0.0", { studio: "main.js" }, undefined, "icon.png");

    const manager = new PluginManager(tempDir, permissionManager as any);
    const result = await manager.installFromDirectory(sourceDir);
    const iconUrl = (result as { plugin: { iconUrl?: string } }).plugin.iconUrl;

    expect(iconUrl).toBe("app://plugins/acme.sample-plugin/1.0.0/icon.png");
    // Freshly installed, so still unauthorized and disabled: the entry stays
    // sealed, the icon does not - the list showing it is how the user decides.
    expect(
      await manager.resolvePluginEntryFile(new URL(iconUrl!.replace("icon.png", "main.js")))
    ).toBeNull();
    expect(await manager.resolvePluginIconFile(new URL(iconUrl!))).toBe(
      path.join(tempDir, "plugins", "acme.sample-plugin", "icon.png")
    );
  });

  it("serves nothing but the declared icon path", async () => {
    await writeIcon(sourceDir, "icon.png", 512);
    await fs.writeFile(path.join(sourceDir, "secret.png"), "not an icon", "utf-8");
    await writePluginPackage(sourceDir, "1.0.0", { studio: "main.js" }, undefined, "icon.png");

    const manager = new PluginManager(tempDir, permissionManager as any);
    await manager.installFromDirectory(sourceDir);

    const base = "app://plugins/acme.sample-plugin/1.0.0";
    // Any other file in the package, a stale version, an unknown plugin: the
    // only address that resolves is the one the manifest declares.
    expect(await manager.resolvePluginIconFile(new URL(`${base}/secret.png`))).toBeNull();
    expect(await manager.resolvePluginIconFile(new URL(`${base}/manifest.json`))).toBeNull();
    expect(
      await manager.resolvePluginIconFile(
        new URL("app://plugins/acme.sample-plugin/9.9.9/icon.png")
      )
    ).toBeNull();
    expect(
      await manager.resolvePluginIconFile(new URL("app://plugins/acme.other/1.0.0/icon.png"))
    ).toBeNull();
  });

  it("refuses a package whose icon breaks the shipping rules", async () => {
    const manager = new PluginManager(tempDir, permissionManager as any);

    await writeIcon(sourceDir, "icon.png", 512, 256);
    await writePluginPackage(sourceDir, "1.0.0", { studio: "main.js" }, undefined, "icon.png");
    await expect(manager.installFromDirectory(sourceDir)).rejects.toThrow(/square/);

    await fs.rm(path.join(sourceDir, "icon.png"));
    await expect(manager.installFromDirectory(sourceDir)).rejects.toThrow(/icon file not found/);
  });
});

/** A PNG header of the given dimensions - enough for the icon checks, which are header-only. */
async function writeIcon(dir: string, name: string, width: number, height = width): Promise<void> {
  const be32 = (value: number) => [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ];
  await fs.writeFile(
    path.join(dir, name),
    Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0,
      0,
      0,
      13,
      0x49,
      0x48,
      0x44,
      0x52,
      ...be32(width),
      ...be32(height),
      8,
      6,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ])
  );
}

/** Approve the pending install prompt for the sample plugin. */
function approve(manager: PluginManager) {
  return manager.approvePlugin("acme.sample-plugin", {
    requestId: "install",
    pluginId: "acme.sample-plugin",
    kind: "install",
    approved: true,
    persistence: "permanent"
  });
}

async function writePluginPackage(
  dir: string,
  version: string,
  entries: Record<string, string> = { studio: "main.js" },
  permissions: unknown[] = [{ kind: "api", capability: "bash.execute" }],
  icon?: string
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const entry of Object.values(entries)) {
    await fs.writeFile(path.join(dir, entry), "export default {};\n", "utf-8");
  }
  await fs.writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      manifestVersion: 2,
      id: "acme.sample-plugin",
      name: "Sample Plugin",
      version,
      description: "Test plugin",
      entries,
      permissions,
      ...(icon ? { icon } : {})
    }),
    "utf-8"
  );
}
