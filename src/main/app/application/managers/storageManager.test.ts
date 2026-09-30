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

    /**
     * The library pass: `requestReadMany` authorizes every file of a project's asset library, one
     * authorization each, and every one of those used to resolve the real path of the *grant* as
     * well as of the file. That is the same two or three directories, several thousand times.
     *
     * Counted rather than timed: a wall-clock assertion on filesystem work is a flake, and the
     * thing that must not come back is the repetition itself.
     */
    it("resolves a grant root once however many paths under it are authorized", async () => {
        const project = path.join(tempDir, "project");
        await fs.mkdir(path.join(project, "assets"), { recursive: true });
        const files = ["a", "b", "c", "d"].map(name => path.join(project, "assets", `${name}.png`));
        await Promise.all(files.map(file => fs.writeFile(file, "x")));

        const manager = new StorageManager({
            getUserDataDir: () => path.join(tempDir, "user-data"),
            getBuiltInPluginsDir: () => path.join(tempDir, "app", "dist", "builtin-plugins"),
            logger: { error: vi.fn(), warn: vi.fn() },
            hasExperimentalCondition: () => false,
        } as any);
        const window = {
            getWindowType: () => WindowAppType.Workspace,
            getProps: () => ({ projectPath: project }),
            getWebContents: () => ({ id: 1 }),
        } as unknown as AppWindow;

        const realpath = vi.spyOn(fs, "realpath");
        const grantRootCalls = () => realpath.mock.calls.filter(([target]) => target === project).length;

        for (const file of files) {
            await expect(manager.inspectWindowPathAccess(window, file, "read"))
                .resolves.toEqual({ protectedStorage: false, granted: true });
        }
        expect(grantRootCalls()).toBe(1);

        // Changing what the window is allowed to reach is what may introduce a root nothing has
        // resolved, so it is what drops the answer.
        manager.grantFileSystemAccess(window, path.join(tempDir, "elsewhere"), "read");
        await manager.inspectWindowPathAccess(window, files[0]!, "read");
        expect(grantRootCalls()).toBe(2);

        realpath.mockRestore();
    });

    it("gives the same two answers as asking the halves separately", async () => {
        const project = path.join(tempDir, "project");
        const userData = path.join(tempDir, "user-data");
        await fs.mkdir(path.join(project, "assets"), { recursive: true });
        await fs.mkdir(path.join(userData, "plugins"), { recursive: true });
        const inside = path.join(project, "assets", "a.png");
        const outside = path.join(tempDir, "stranger.png");
        const protectedFile = path.join(userData, "plugins", "main.js");
        await Promise.all([inside, outside, protectedFile].map(file => fs.writeFile(file, "x")));

        const manager = new StorageManager({
            getUserDataDir: () => userData,
            getBuiltInPluginsDir: () => path.join(tempDir, "app", "dist", "builtin-plugins"),
            logger: { error: vi.fn(), warn: vi.fn() },
            hasExperimentalCondition: () => false,
        } as any);
        const window = {
            getWindowType: () => WindowAppType.Workspace,
            getProps: () => ({ projectPath: project }),
            getWebContents: () => ({ id: 1 }),
        } as unknown as AppWindow;

        for (const file of [inside, outside, protectedFile]) {
            const combined = await manager.inspectWindowPathAccess(window, file, "read");
            expect(combined).toEqual({
                protectedStorage: await manager.isPathProtected(file),
                granted: combined.protectedStorage ? false : await manager.isPathAllowed(window, file, "read"),
            });
        }
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
