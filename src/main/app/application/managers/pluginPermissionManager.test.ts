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
    const plugin: PluginIdentity = { id: "plugin.test", name: "Plugin Test", version: "0.0.1" };

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

        expect(manager.isPluginFileSystemAllowed(plugin.id, plugin.version, path.join(root, "story.json"), "read")).toBe(true);
        expect(manager.isPluginFileSystemAllowed(plugin.id, plugin.version, path.join(root, "story.json"), "write")).toBe(false);
        expect(manager.isPluginFileSystemAllowed(plugin.id, plugin.version, path.join(tempDir, "other", "story.json"), "read")).toBe(false);
        expect(manager.isPluginFileSystemAllowed("plugin.other", plugin.version, path.join(root, "story.json"), "read")).toBe(false);
    });

    it("returns existing filesystem grants instead of requiring another prompt", () => {
        const filePath = path.join(tempDir, "Desktop", "narraleaf-plugin-permission-test.txt");
        manager.grantPermission({
            kind: "filesystem",
            requestId: "fs-1",
            plugin,
            path: filePath,
            mode: "readwrite",
            recursive: false,
            persistence: "permanent",
        }, {
            requestId: "fs-1",
            approved: true,
            persistence: "permanent",
        });

        const existing = manager.getExistingGrantResult({
            kind: "filesystem",
            requestId: "fs-2",
            plugin,
            path: filePath,
            mode: "readwrite",
            recursive: false,
            persistence: "permanent",
        });

        expect(existing).toMatchObject({
            requestId: "fs-2",
            pluginId: plugin.id,
            kind: "filesystem",
            approved: true,
            persistence: "permanent",
        });
    });

    it("returns temporary filesystem grants for repeated allow-once requests in the same session", () => {
        const filePath = path.join(tempDir, "Desktop", "narraleaf-plugin-permission-test.txt");
        manager.grantPermission({
            kind: "filesystem",
            requestId: "fs-1",
            plugin,
            path: filePath,
            mode: "readwrite",
            recursive: false,
            persistence: "permanent",
        }, {
            requestId: "fs-1",
            approved: true,
            persistence: "temporary",
        });

        const existing = manager.getExistingGrantResult({
            kind: "filesystem",
            requestId: "fs-2",
            plugin,
            path: filePath,
            mode: "readwrite",
            recursive: false,
            persistence: "permanent",
        });

        expect(existing).toMatchObject({
            requestId: "fs-2",
            pluginId: plugin.id,
            kind: "filesystem",
            approved: true,
            persistence: "temporary",
        });
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

        expect(manager.isPluginCapabilityAllowed(plugin.id, plugin.version, ApiCapability.BashExecute)).toBe(true);
        expect(manager.isPluginCapabilityAllowed("plugin.other", plugin.version, ApiCapability.BashExecute)).toBe(false);
        expect(manager.isPluginCapabilityAllowed(plugin.id, plugin.version, "plugin.install")).toBe(false);
    });

    it("approves install prompts and grants declared manifest permissions for that plugin version", () => {
        const result = manager.grantPermission({
            kind: "install",
            requestId: "install-1",
            plugin,
            source: "local",
            permissions: [
                {
                    kind: "api",
                    capability: ApiCapability.BashExecute,
                },
            ],
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
        expect(manager.isPluginCapabilityAllowed(plugin.id, plugin.version, ApiCapability.BashExecute)).toBe(true);
        expect(manager.isPluginCapabilityAllowed(plugin.id, "0.0.2", ApiCapability.BashExecute)).toBe(false);
    });

    it("revokes all persistent and temporary grants for an uninstalled plugin", () => {
        const filePath = path.join(tempDir, "Desktop", "narraleaf-plugin-permission-test.txt");
        manager.grantPermission({
            kind: "trust",
            requestId: "trust-1",
            plugin,
            persistence: "permanent",
        }, {
            requestId: "trust-1",
            approved: true,
            persistence: "permanent",
        });
        manager.grantPermission({
            kind: "filesystem",
            requestId: "fs-1",
            plugin,
            path: filePath,
            mode: "readwrite",
            recursive: false,
            persistence: "permanent",
        }, {
            requestId: "fs-1",
            approved: true,
            persistence: "permanent",
        });
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

        manager.revokePluginPermissions(plugin.id);

        expect(manager.isPluginTrusted(plugin.id, plugin.version)).toBe(false);
        expect(manager.isPluginFileSystemAllowed(plugin.id, plugin.version, filePath, "read")).toBe(false);
        expect(manager.isPluginFileSystemAllowed(plugin.id, plugin.version, filePath, "write")).toBe(false);
        expect(manager.isPluginCapabilityAllowed(plugin.id, plugin.version, ApiCapability.BashExecute)).toBe(false);
        expect(manager.getExistingGrantResult({
            kind: "filesystem",
            requestId: "fs-2",
            plugin,
            path: filePath,
            mode: "readwrite",
            recursive: false,
            persistence: "permanent",
        })).toBeNull();
    });
});
