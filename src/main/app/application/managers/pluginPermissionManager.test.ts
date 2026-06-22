import os from "os";
import path from "path";
import fs from "fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginPermissionManager } from "./pluginPermissionManager";
import { ApiCapability, PluginIdentity } from "@shared/types/pluginPermissions";

vi.mock("electron", () => ({
    app: {
        getPath: () => "/tmp",
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

describe("PluginPermissionManager actor grants", () => {
    let tempDir: string;
    let manager: PluginPermissionManager;
    const plugin: PluginIdentity = { id: "plugin.test", name: "Plugin Test" };

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-plugin-perms-"));
        manager = new PluginPermissionManager(tempDir);
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("checks filesystem grants by plugin id, path, mode, and recursion", () => {
        const root = path.join(tempDir, "project");
        manager.grantPermission({
            kind: "filesystem",
            requestId: "fs-1",
            plugin,
            path: root,
            mode: "read",
            recursive: true,
            persistence: "temporary",
        }, {
            requestId: "fs-1",
            approved: true,
            persistence: "temporary",
        });

        expect(manager.isPluginFileSystemAllowed(plugin.id, path.join(root, "story.json"), "read")).toBe(true);
        expect(manager.isPluginFileSystemAllowed(plugin.id, path.join(root, "story.json"), "write")).toBe(false);
        expect(manager.isPluginFileSystemAllowed(plugin.id, path.join(tempDir, "other", "story.json"), "read")).toBe(false);
        expect(manager.isPluginFileSystemAllowed("plugin.other", path.join(root, "story.json"), "read")).toBe(false);
    });

    it("checks api and bash grants by plugin id", () => {
        manager.grantPermission({
            kind: "api",
            requestId: "api-1",
            plugin,
            capability: ApiCapability.BashExecute,
            persistence: "temporary",
        }, {
            requestId: "api-1",
            approved: true,
            persistence: "temporary",
        });

        expect(manager.isPluginCapabilityAllowed(plugin.id, ApiCapability.BashExecute)).toBe(true);
        expect(manager.isPluginCapabilityAllowed("plugin.other", ApiCapability.BashExecute)).toBe(false);
        expect(manager.isPluginCapabilityAllowed(plugin.id, "plugin.install")).toBe(false);
    });

    it("approves install prompts without creating reusable plugin capability grants", () => {
        const result = manager.grantPermission({
            kind: "install",
            requestId: "install-1",
            plugin,
            source: "local",
        }, {
            requestId: "install-1",
            approved: true,
        });

        expect(result).toMatchObject({
            requestId: "install-1",
            pluginId: plugin.id,
            kind: "install",
            approved: true,
            persistence: "temporary",
        });
        expect(manager.isPluginCapabilityAllowed(plugin.id, "plugin.install")).toBe(false);
    });
});
