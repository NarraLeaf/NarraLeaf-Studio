import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserDataNamespace } from "@shared/types/constants";
import type { DevModeSaveProjectRef } from "@shared/types/devModeSave";
import type { AppWindow } from "../appWindow";
import {
    BlueprintPersistenceGetAllHandler,
    BlueprintPersistenceSetValueHandler,
} from "./blueprintPersistenceAction";
import { DevModeDataResetHandler } from "./devModeDataResetAction";
import { DevModeSaveListIdsHandler, DevModeSaveWriteHandler } from "./devModeSaveAction";

/**
 * Persistence store standing in for the electron-store the real `createState` returns: the reset
 * calls `clear`, so a memory double has to answer it.
 */
class MemoryPersistentState {
    constructor(private values: Record<string, unknown>) {}

    public raw(): Record<string, unknown> {
        return this.values;
    }

    public getItem(key: string): unknown {
        return this.values[key];
    }

    public setItem(key: string, value: unknown): void {
        this.values[key] = value;
    }

    public removeItem(key: string): void {
        delete this.values[key];
    }

    public clear(): void {
        this.values = {};
    }
}

let tempDir = "";

/** A window whose saves land on disk (real fs) and whose persistence is an in-memory store. */
function createWindow(): AppWindow {
    const stores = new Map<string, MemoryPersistentState>();
    return {
        app: {
            storageManager: {
                getNamespacePath(namespace: UserDataNamespace) {
                    return path.join(tempDir, namespace);
                },
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
}

describe("DevModeDataResetHandler", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-dev-reset-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("clears one project's save slots and persistence, and leaves other projects alone", async () => {
        const window = createWindow();
        const write = new DevModeSaveWriteHandler();
        const setValue = new BlueprintPersistenceSetValueHandler();
        const listIds = new DevModeSaveListIdsHandler();
        const getAll = new BlueprintPersistenceGetAllHandler();
        const reset = new DevModeDataResetHandler();
        const projectA: DevModeSaveProjectRef = { projectIdentifier: "project-a", projectPath: "/tmp/project" };
        const projectB: DevModeSaveProjectRef = { projectIdentifier: "project-b", projectPath: "/tmp/project" };

        for (const project of [projectA, projectB]) {
            await write.handle(window, { projectRef: project, id: "slot 1", savedGame: { at: project.projectIdentifier } });
            expect(setValue.handle(window, { projectRef: project, key: "unlocks.gallery", value: true }).success).toBe(true);
        }

        await expect(reset.handle(window, { projectRef: projectA })).resolves.toMatchObject({ success: true });

        // Project A is empty on both stores.
        await expect(listIds.handle(window, { projectRef: projectA })).resolves.toEqual({
            success: true,
            data: { ids: [] },
        });
        expect(getAll.handle(window, { projectRef: projectA })).toEqual({
            success: true,
            data: { values: {} },
        });

        // Project B is untouched - the reset is scoped to the ref it was given.
        await expect(listIds.handle(window, { projectRef: projectB })).resolves.toEqual({
            success: true,
            data: { ids: ["slot 1"] },
        });
        expect(getAll.handle(window, { projectRef: projectB })).toEqual({
            success: true,
            data: { values: { "unlocks.gallery": true } },
        });
    });

    it("succeeds on a project that never wrote anything", async () => {
        const window = createWindow();
        const reset = new DevModeDataResetHandler();
        const projectRef: DevModeSaveProjectRef = { projectPath: "/tmp/never-run" };

        await expect(reset.handle(window, { projectRef })).resolves.toMatchObject({ success: true });
    });
});
