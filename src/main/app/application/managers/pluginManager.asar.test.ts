import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_NAMED_FILES, unsimulatedFs as fs, writeArchiveNamedTree } from "@shared/utils/asarPatchSimulation";
import { PluginManager } from "./pluginManager";

// Electron's asar patch, reproduced: see asarPatchSimulation.ts. A plugin is a folder somebody else
// wrote, and nothing stops it shipping an archive of its own.
vi.mock("fs", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsModule());
vi.mock("fs/promises", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsPromisesModule());
afterAll(async () => (await import("@shared/utils/asarPatchSimulation")).restoreOriginalFs());

vi.mock("@shared/utils/persistentState", () => {
    const stores = new Map<string, Record<string, unknown>>();
    return {
        PersistentState: class<T extends Record<string, unknown>> {
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

const PLUGIN_ID = "acme.archive-plugin";

let tempDir: string;
const permissionManager = {
    revokePluginPermissions: vi.fn(),
    grantPermission: vi.fn(),
};

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nls-plugin-asar-"));
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function writePluginPackage(dir: string, version: string): ReturnType<typeof writeArchiveNamedTree> {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "main.js"), "export default {};\n");
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
        manifestVersion: 2,
        id: PLUGIN_ID,
        name: "Archive Plugin",
        version,
        description: "Ships an archive of its own",
        entries: { studio: "main.js" },
        permissions: [],
    }));
    return writeArchiveNamedTree(dir);
}

describe("a plugin package holding files named like archives", () => {
    it("installs, updates over itself and uninstalls with them as plain files", async () => {
        const manager = new PluginManager(tempDir, permissionManager as never);
        const installPath = path.join(tempDir, "plugins", PLUGIN_ID);

        const first = writePluginPackage(path.join(tempDir, "source-1"), "1.0.0");
        await manager.installFromDirectory(path.join(tempDir, "source-1"));
        for (const relative of ARCHIVE_NAMED_FILES) {
            expect(fs.readFileSync(path.join(installPath, ...relative.split("/"))).equals(first[relative])).toBe(true);
        }

        // An update removes the installed copy, archive and all, before the new one takes its place.
        writePluginPackage(path.join(tempDir, "source-2"), "1.1.0");
        const updated = await manager.installFromDirectory(path.join(tempDir, "source-2"));
        expect(updated.canceled).toBe(false);
        expect(JSON.parse(fs.readFileSync(path.join(installPath, "manifest.json"), "utf-8")).version).toBe("1.1.0");

        await manager.uninstallPlugin(PLUGIN_ID);
        expect(fs.existsSync(installPath)).toBe(false);
    });
});
