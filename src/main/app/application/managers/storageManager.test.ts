import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";
import { StorageManager } from "./storageManager";
import type { AppWindow } from "./window/appWindow";

vi.mock("electron", () => ({
    app: {
        startAccessingSecurityScopedResource: vi.fn(() => vi.fn()),
    },
}));

vi.mock("@shared/utils/persistentState", () => ({
    PersistentState: class<T extends Record<string, any>> {
        private store: T;

        constructor(config: { defaults: T }) {
            this.store = JSON.parse(JSON.stringify(config.defaults));
        }

        getItem<K extends keyof T>(key: K): T[K] {
            return this.store[key];
        }

        setItem<K extends keyof T>(key: K, value: T[K]): void {
            this.store[key] = value;
        }
    },
}));

describe("StorageManager filesystem policy", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-storage-policy-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("authorizes missing deep descendants below a symlinked project root", async () => {
        const realProject = path.join(tempDir, "real-project");
        const linkedProject = path.join(tempDir, "linked-project");
        await fs.mkdir(realProject, { recursive: true });
        await fs.symlink(realProject, linkedProject, "dir");

        const manager = new StorageManager({
            getUserDataDir: () => path.join(tempDir, "user-data"),
            getBuiltInPluginsDir: () => path.join(tempDir, "app", "dist", "builtin-plugins"),
            logger: {
                error: vi.fn(),
                warn: vi.fn(),
            },
            hasExperimentalCondition: () => false,
        } as any);
        const window = {
            getWindowType: () => WindowAppType.Workspace,
            getProps: () => ({ projectPath: linkedProject }),
            getWebContents: () => ({ id: 1 }),
        } as unknown as AppWindow;

        await expect(manager.isPathAllowed(
            window,
            path.join(linkedProject, "editor", "story", "stories", "story-1", "storydoc.json"),
            "write",
        )).resolves.toBe(true);
    });

    it("protects installed and built-in plugin directories", async () => {
        const userData = path.join(tempDir, "user-data");
        const builtInPlugins = path.join(tempDir, "app", "dist", "builtin-plugins");
        const manager = new StorageManager({
            getUserDataDir: () => userData,
            getBuiltInPluginsDir: () => builtInPlugins,
            logger: {
                error: vi.fn(),
                warn: vi.fn(),
            },
            hasExperimentalCondition: () => false,
        } as any);

        await expect(manager.isPathProtected(
            path.join(userData, "plugins", "narraleaf.gallery", "main.js"),
        )).resolves.toBe(true);
        await expect(manager.isPathProtected(
            path.join(builtInPlugins, "gallery", "main.js"),
        )).resolves.toBe(true);
    });
});

/**
 * The experimental `unscoped-file-access` condition, which is only interesting for what it does NOT
 * widen. It is the one flag in the registry that can make an acceptance run pass on a path the
 * shipped product would refuse, so the two things holding it in place - it never reaches protected
 * storage, and every path it does let through is named in the log - are worth a test each.
 */
describe("StorageManager under unscoped-file-access", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-storage-unscoped-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    function makeManager(unscoped: boolean) {
        const warn = vi.fn();
        const manager = new StorageManager({
            getUserDataDir: () => path.join(tempDir, "user-data"),
            getBuiltInPluginsDir: () => path.join(tempDir, "app", "dist", "builtin-plugins"),
            logger: { error: vi.fn(), warn },
            hasExperimentalCondition: (id: string) => unscoped && id === "unscoped-file-access",
        } as any);
        const window = {
            getWindowType: () => WindowAppType.Workspace,
            getProps: () => ({ projectPath: path.join(tempDir, "project") }),
            getWebContents: () => ({ id: 1 }),
        } as unknown as AppWindow;
        return { manager, window, warn };
    }

    it("lets a window reach a path nothing granted, and says so once per path", async () => {
        const outside = path.join(tempDir, "elsewhere", "notes.txt");
        const off = makeManager(false);
        await expect(off.manager.isPathAllowed(off.window, outside, "write")).resolves.toBe(false);

        const on = makeManager(true);
        await expect(on.manager.isPathAllowed(on.window, outside, "write")).resolves.toBe(true);
        await expect(on.manager.isPathAllowed(on.window, outside, "write")).resolves.toBe(true);

        // Once, not once per call: the line is a record of which paths the run leaned on, and a
        // read loop would bury it under thousands of copies of itself.
        const lines = on.warn.mock.calls.filter(call => String(call[0]).includes("unscoped-file-access"));
        expect(lines).toHaveLength(1);
        expect(String(lines[0][0])).toContain(path.resolve(outside));
    });

    it("still refuses protected storage, which no permission ever opens", async () => {
        const { manager, window } = makeManager(true);
        const pluginFile = path.join(tempDir, "user-data", "plugins", "narraleaf.gallery", "main.js");
        await expect(manager.isPathAllowed(window, pluginFile, "write")).resolves.toBe(false);
    });
});
