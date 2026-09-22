import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginManager } from "./pluginManager";

/**
 * The registry as electron-store keeps it: one JSON file, serialized with tabs, rewritten whole on
 * construction and on every `set`. On disk rather than in memory because the guarantee under test is
 * about the file - a job pointed at somebody's own profile must leave `plugin-registry.json` exactly
 * as it found it - and a store that only counted writes would pass a run that wrote the same file
 * with a new timestamp in it.
 */
vi.mock("@shared/utils/persistentState", async () => {
    const nodeFs = await import("fs");
    const nodePath = await import("path");
    return {
        PersistentState: class<T extends Record<string, unknown>> {
            private readonly file: string;

            constructor(config: { dbPath: string; defaults: T }) {
                const directory = nodePath.dirname(config.dbPath);
                const name = nodePath.basename(config.dbPath, nodePath.extname(config.dbPath));
                this.file = nodePath.join(directory, `${name}.json`);
                nodeFs.mkdirSync(directory, { recursive: true });
                const existing = nodeFs.existsSync(this.file) ? JSON.parse(nodeFs.readFileSync(this.file, "utf8")) : {};
                this.write({ ...JSON.parse(JSON.stringify(config.defaults)), ...existing });
            }

            getItem<K extends keyof T>(key: K): T[K] {
                return this.read()[key];
            }

            setItem<K extends keyof T>(key: K, value: T[K]): void {
                this.write({ ...this.read(), [key]: value });
            }

            private read(): T {
                return JSON.parse(nodeFs.readFileSync(this.file, "utf8"));
            }

            private write(store: T): void {
                nodeFs.writeFileSync(this.file, JSON.stringify(store, undefined, "\t"));
            }
        },
    };
});

describe("PluginManager, switched on for a command-line run", () => {
    let userDataDir: string;
    let builtInPluginsDir: string;
    let registryFile: string;
    const permissionManager = {
        revokePluginPermissions: vi.fn(),
        grantPermission: vi.fn(),
    };

    /** A process of its own, as each command-line run is: a fresh manager over the same profile. */
    const launch = () => new PluginManager(userDataDir, permissionManager as never, { builtInPluginsDir });

    beforeEach(async () => {
        userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-run-"));
        builtInPluginsDir = path.join(userDataDir, "..", `${path.basename(userDataDir)}-builtin`);
        registryFile = path.join(userDataDir, "plugins", "plugin-registry.json");
        // Gallery ships switched off; Quick Save ships on. Both are granted when installed.
        await writePlugin(path.join(builtInPluginsDir, "gallery"), "narraleaf.gallery", "Gallery", "3.1.0");
        await writePlugin(path.join(builtInPluginsDir, "quick-save"), "narraleaf.quick-save", "Quick Save", "1.0.0");

        // The run that made the profile: a scan, and the workspace reporting that Quick Save started.
        const first = launch();
        await first.listPlugins();
        await first.reportLoadError("narraleaf.quick-save", null);
    });

    afterEach(async () => {
        await fs.rm(userDataDir, { recursive: true, force: true });
        await fs.rm(builtInPluginsDir, { recursive: true, force: true });
    });

    it("runs a plugin the profile has switched off, and leaves the registry byte for byte as it was", async () => {
        const before = await fs.readFile(registryFile);
        expect(JSON.parse(before.toString("utf8"))["plugin.records"]["narraleaf.gallery"].enabled).toBe(false);

        const run = launch();
        await run.enableForCommandLineRun(["narraleaf.gallery"]);

        // Every reader sees it on: the plugin list, the workspace's load, a build's or a test's pack,
        // and the protocol that serves its entry.
        const gallery = (await run.listPlugins()).find(plugin => plugin.pluginId === "narraleaf.gallery");
        expect(gallery).toMatchObject({ enabled: true, status: "enabled" });
        expect((await run.listWorkspacePlugins()).map(plugin => plugin.plugin.id)).toContain("narraleaf.gallery");
        expect((await run.listRuntimePluginPackSources()).map(source => source.manifest.id)).toContain("narraleaf.gallery");
        await expect(run.resolvePluginEntryFile(new URL("app://plugins/narraleaf.gallery/3.1.0/studio.js"))).resolves
            .toBe(path.join(userDataDir, "plugins", "narraleaf.gallery", "studio.js"));

        // What a run does to the registry on its way through: every plugin reports how its start went,
        // one of them fails, and a rebuild of the built-ins rescans the folder.
        await run.reportLoadError("narraleaf.quick-save", null);
        await run.reportLoadError("narraleaf.gallery", null);
        await run.reportLoadError("narraleaf.gallery", "setup threw");
        expect((await run.listPlugins()).find(plugin => plugin.pluginId === "narraleaf.gallery"))
            .toMatchObject({ status: "error", lastError: "setup threw" });
        await run.refreshBuiltInPlugins();

        expect((await fs.readFile(registryFile)).equals(before)).toBe(true);

        // And the next Studio on this profile finds the author's own choice, with no failure against it.
        const next = (await launch().listPlugins()).find(plugin => plugin.pluginId === "narraleaf.gallery");
        expect(next).toMatchObject({ enabled: false, status: "disabled", lastError: null });
    });

    it("writes nothing when a start reports what the last one did", async () => {
        const before = await fs.readFile(registryFile);

        await launch().reportLoadError("narraleaf.quick-save", null);

        expect((await fs.readFile(registryFile)).equals(before)).toBe(true);
    });

    it("refuses a third-party plugin whose permissions this profile never granted, and switches nothing on", async () => {
        const source = path.join(userDataDir, "..", `${path.basename(userDataDir)}-stats`);
        await writePlugin(source, "acme.stats", "Stats", "1.2.0", [{ kind: "api", capability: "bash.execute" }]);
        const run = launch();
        await run.installFromDirectory(source);

        await expect(run.enableForCommandLineRun(["narraleaf.gallery", "acme.stats"])).rejects
            .toThrow("has not been granted its permissions");
        expect((await run.listWorkspacePlugins()).map(plugin => plugin.plugin.id)).not.toContain("narraleaf.gallery");
        expect((await run.listPlugins()).find(plugin => plugin.pluginId === "acme.stats"))
            .toMatchObject({ enabled: false, status: "needsAuthorization" });
        await fs.rm(source, { recursive: true, force: true });
    });
});

async function writePlugin(
    dir: string,
    id: string,
    name: string,
    version: string,
    permissions: unknown[] = [],
): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "studio.js"), "export default {};\n", "utf-8");
    await fs.writeFile(path.join(dir, "runtime.js"), "export default {};\n", "utf-8");
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({
        manifestVersion: 2,
        id,
        name,
        version,
        description: "Test plugin",
        entries: { studio: "studio.js", runtime: "runtime.js" },
        permissions,
    }), "utf-8");
}
