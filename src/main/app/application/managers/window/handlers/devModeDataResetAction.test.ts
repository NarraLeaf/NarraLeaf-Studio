import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserDataNamespace } from "@shared/types/constants";
import type { DevModeSaveProjectRef } from "@shared/types/devModeSave";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { forgetProjectStoreIdentifiers } from "../../../utils/windowProjectStore";
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

/**
 * Windows whose saves land on disk (real fs) and whose persistence is an in-memory store shared
 * between them, as the real storage manager's is. Each is open on one project.
 */
function createWindows(): (projectPath: string) => AppWindow {
    const stores = new Map<string, MemoryPersistentState>();
    return projectPath => ({
        getProps: () => ({ projectPath }),
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
    }) as unknown as AppWindow;
}

async function createProject(name: string, identifier: string): Promise<string> {
    const projectPath = path.join(tempDir, "projects", name);
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
        path.join(projectPath, "game.nlproj"),
        encodeProjectConfig({ name, identifier, metadata: {} }),
    );
    return projectPath;
}

describe("DevModeDataResetHandler", () => {
    beforeEach(async () => {
        forgetProjectStoreIdentifiers();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-dev-reset-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("clears one project's save slots and persistence, and leaves other projects alone", async () => {
        const windowOn = createWindows();
        const write = new DevModeSaveWriteHandler();
        const setValue = new BlueprintPersistenceSetValueHandler();
        const listIds = new DevModeSaveListIdsHandler();
        const getAll = new BlueprintPersistenceGetAllHandler();
        const reset = new DevModeDataResetHandler();
        const projectA: DevModeSaveProjectRef = { projectPath: await createProject("a", "project-a") };
        const projectB: DevModeSaveProjectRef = { projectPath: await createProject("b", "project-b") };
        const windowA = windowOn(projectA.projectPath);
        const windowB = windowOn(projectB.projectPath);

        for (const [window, project] of [[windowA, projectA], [windowB, projectB]] as const) {
            await write.handle(window, { projectRef: project, id: "slot 1", savedGame: { at: project.projectPath } });
            expect((await setValue.handle(window, { projectRef: project, key: "unlocks.gallery", value: true })).success)
                .toBe(true);
        }

        await expect(reset.handle(windowA, { projectRef: projectA })).resolves.toMatchObject({ success: true });

        // Project A is empty on both stores.
        await expect(listIds.handle(windowA, { projectRef: projectA })).resolves.toEqual({
            success: true,
            data: { ids: [] },
        });
        await expect(getAll.handle(windowA, { projectRef: projectA })).resolves.toEqual({
            success: true,
            data: { values: {} },
        });

        // Project B is untouched - the reset is scoped to the window's own project.
        await expect(listIds.handle(windowB, { projectRef: projectB })).resolves.toEqual({
            success: true,
            data: { ids: ["slot 1"] },
        });
        await expect(getAll.handle(windowB, { projectRef: projectB })).resolves.toEqual({
            success: true,
            data: { values: { "unlocks.gallery": true } },
        });
    });

    it("succeeds on a project that never wrote anything", async () => {
        const projectPath = await createProject("never-run", "never-run");
        const reset = new DevModeDataResetHandler();

        await expect(reset.handle(createWindows()(projectPath), { projectRef: { projectPath } }))
            .resolves.toMatchObject({ success: true });
    });
});
