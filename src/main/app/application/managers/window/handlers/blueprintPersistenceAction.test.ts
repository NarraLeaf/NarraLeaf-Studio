import { describe, expect, it } from "vitest";
import { UserDataNamespace } from "@shared/types/constants";
import type { BlueprintPersistenceProjectRef } from "@shared/types/ipcEvents";
import type { AppWindow } from "../appWindow";
import {
    BlueprintPersistenceGetAllHandler,
    BlueprintPersistenceGetValueHandler,
    BlueprintPersistenceRemoveValueHandler,
    BlueprintPersistenceSetValueHandler,
} from "./blueprintPersistenceAction";

class MemoryPersistentState {
    constructor(private readonly values: Record<string, unknown>) {}

    public raw(): Record<string, unknown> {
        return this.values;
    }

    public getItem(key: string): unknown {
        this.ensureValidKey(key);
        return this.values[key];
    }

    public setItem(key: string, value: unknown): void {
        this.ensureValidKey(key);
        this.values[key] = value;
    }

    public removeItem(key: string): void {
        this.ensureValidKey(key);
        delete this.values[key];
    }

    private ensureValidKey(key: string): void {
        const keyPattern = /^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$/;
        if (!keyPattern.test(key) || key.length === 0) {
            throw new Error(`Invalid key: "${key}". Keys must contain only English letters, numbers, and dots.`);
        }
    }
}

function createWindow() {
    const stores = new Map<string, MemoryPersistentState>();
    const window = {
        app: {
            storageManager: {
                createState(namespace: UserDataNamespace, name: string, defaults: Record<string, unknown>) {
                    const key = `${namespace}:${name}`;
                    let store = stores.get(key);
                    if (!store) {
                        store = new MemoryPersistentState({ ...defaults });
                        stores.set(key, store);
                    }
                    return store;
                },
            },
        },
    } as unknown as AppWindow;
    return { window, stores };
}

describe("blueprint persistence IPC handlers", () => {
    it("isolates values by project identifier and removes saved values", () => {
        const { window } = createWindow();
        const set = new BlueprintPersistenceSetValueHandler();
        const getAll = new BlueprintPersistenceGetAllHandler();
        const get = new BlueprintPersistenceGetValueHandler();
        const remove = new BlueprintPersistenceRemoveValueHandler();
        const projectA: BlueprintPersistenceProjectRef = { projectIdentifier: "project-a", projectPath: "/tmp/project" };
        const projectB: BlueprintPersistenceProjectRef = { projectIdentifier: "project-b", projectPath: "/tmp/project" };

        expect(set.handle(window, { projectRef: projectA, key: "settings.volume", value: 0.8 }).success).toBe(true);

        expect(get.handle(window, { projectRef: projectA, key: "settings.volume" })).toEqual({
            success: true,
            data: { value: 0.8 },
        });
        expect(getAll.handle(window, { projectRef: projectA })).toEqual({
            success: true,
            data: { values: { "settings.volume": 0.8 } },
        });
        expect(get.handle(window, { projectRef: projectB, key: "settings.volume" })).toEqual({
            success: true,
            data: { value: undefined },
        });

        expect(remove.handle(window, { projectRef: projectA, key: "settings.volume" }).success).toBe(true);
        expect(get.handle(window, { projectRef: projectA, key: "settings.volume" })).toEqual({
            success: true,
            data: { value: undefined },
        });
    });

    it("uses project-path fallback namespaces and rejects invalid keys", () => {
        const { window } = createWindow();
        const set = new BlueprintPersistenceSetValueHandler();
        const get = new BlueprintPersistenceGetValueHandler();
        const firstPath: BlueprintPersistenceProjectRef = { projectPath: "/tmp/legacy-a" };
        const secondPath: BlueprintPersistenceProjectRef = { projectPath: "/tmp/legacy-b" };

        expect(set.handle(window, { projectRef: firstPath, key: "flag", value: true }).success).toBe(true);
        expect(get.handle(window, { projectRef: firstPath, key: "flag" })).toEqual({
            success: true,
            data: { value: true },
        });
        expect(get.handle(window, { projectRef: secondPath, key: "flag" })).toEqual({
            success: true,
            data: { value: undefined },
        });

        expect(set.handle(window, { projectRef: firstPath, key: "bad/key", value: true })).toMatchObject({
            success: false,
        });
    });
});
