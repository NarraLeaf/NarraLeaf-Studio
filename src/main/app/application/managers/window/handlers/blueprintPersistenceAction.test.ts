import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserDataNamespace } from "@shared/types/constants";
import type { BlueprintPersistenceProjectRef } from "@shared/types/ipcEvents";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { forgetProjectStoreIdentifiers } from "../../../utils/windowProjectStore";
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

let tempDir = "";

/** One set of stores shared by every window made from it, as the real storage manager is. */
function createStores() {
    const stores = new Map<string, MemoryPersistentState>();
    const storageManager = {
        createState(namespace: UserDataNamespace, name: string, defaults: Record<string, unknown>) {
            const key = `${namespace}:${name}`;
            let store = stores.get(key);
            if (!store) {
                store = new MemoryPersistentState({ ...defaults });
                stores.set(key, store);
            }
            return store;
        },
    };
    /** A Dev Mode window open on one project. */
    const windowOn = (projectPath: string) => ({
        getProps: () => ({ projectPath }),
        app: { storageManager },
    }) as unknown as AppWindow;
    return { windowOn, stores };
}

/** A project folder; `identifier` null leaves its configuration without one. */
async function createProject(name: string, identifier: string | null): Promise<string> {
    const projectPath = path.join(tempDir, name);
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
        path.join(projectPath, "game.nlproj"),
        encodeProjectConfig({ name, identifier: identifier ?? "", metadata: {} }),
    );
    return projectPath;
}

describe("blueprint persistence IPC handlers", () => {
    beforeEach(async () => {
        forgetProjectStoreIdentifiers();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-bp-persist-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("isolates values by project and removes saved values", async () => {
        const { windowOn } = createStores();
        const set = new BlueprintPersistenceSetValueHandler();
        const getAll = new BlueprintPersistenceGetAllHandler();
        const get = new BlueprintPersistenceGetValueHandler();
        const remove = new BlueprintPersistenceRemoveValueHandler();
        const pathA = await createProject("a", "project-a");
        const pathB = await createProject("b", "project-b");
        const projectA: BlueprintPersistenceProjectRef = { projectPath: pathA };
        const projectB: BlueprintPersistenceProjectRef = { projectPath: pathB };
        const windowA = windowOn(pathA);

        expect((await set.handle(windowA, { projectRef: projectA, key: "settings.volume", value: 0.8 })).success)
            .toBe(true);

        await expect(get.handle(windowA, { projectRef: projectA, key: "settings.volume" })).resolves.toEqual({
            success: true,
            data: { value: 0.8 },
        });
        await expect(getAll.handle(windowA, { projectRef: projectA })).resolves.toEqual({
            success: true,
            data: { values: { "settings.volume": 0.8 } },
        });
        await expect(get.handle(windowOn(pathB), { projectRef: projectB, key: "settings.volume" })).resolves.toEqual({
            success: true,
            data: { value: undefined },
        });

        expect((await remove.handle(windowA, { projectRef: projectA, key: "settings.volume" })).success).toBe(true);
        await expect(get.handle(windowA, { projectRef: projectA, key: "settings.volume" })).resolves.toEqual({
            success: true,
            data: { value: undefined },
        });
    });

    it("uses project-path fallback namespaces and rejects invalid keys", async () => {
        const { windowOn } = createStores();
        const set = new BlueprintPersistenceSetValueHandler();
        const get = new BlueprintPersistenceGetValueHandler();
        const firstPath = await createProject("legacy-a", null);
        const secondPath = await createProject("legacy-b", null);
        const first: BlueprintPersistenceProjectRef = { projectPath: firstPath };
        const second: BlueprintPersistenceProjectRef = { projectPath: secondPath };

        expect((await set.handle(windowOn(firstPath), { projectRef: first, key: "flag", value: true })).success)
            .toBe(true);
        await expect(get.handle(windowOn(firstPath), { projectRef: first, key: "flag" })).resolves.toEqual({
            success: true,
            data: { value: true },
        });
        await expect(get.handle(windowOn(secondPath), { projectRef: second, key: "flag" })).resolves.toEqual({
            success: true,
            data: { value: undefined },
        });

        await expect(set.handle(windowOn(firstPath), { projectRef: first, key: "bad/key", value: true }))
            .resolves.toMatchObject({ success: false });
    });
});
