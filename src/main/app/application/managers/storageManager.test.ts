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
        } as any);

        await expect(manager.isPathProtected(
            path.join(userData, "plugins", "narraleaf.gallery", "main.js"),
        )).resolves.toBe(true);
        await expect(manager.isPathProtected(
            path.join(builtInPlugins, "gallery", "main.js"),
        )).resolves.toBe(true);
    });
});
