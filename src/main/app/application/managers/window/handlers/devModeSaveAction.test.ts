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
    DevModeSaveDeleteHandler,
    DevModeSaveListIdsHandler,
    DevModeSaveReadHandler,
    DevModeSaveReadPreviewHandler,
    DevModeSaveWriteHandler,
} from "./devModeSaveAction";

let tempDir = "";

/** A Dev Mode window open on one project, whose stores land on disk under the temp directory. */
function createWindow(projectPath: string): AppWindow {
    return {
        getProps: () => ({ projectPath }),
        app: {
            storageManager: {
                getNamespacePath(namespace: UserDataNamespace) {
                    return path.join(tempDir, namespace);
                },
            },
        },
    } as unknown as AppWindow;
}

/** A project folder whose configuration carries `identifier`, which is what names its stores. */
async function createProject(name: string, identifier: string): Promise<string> {
    const projectPath = path.join(tempDir, "projects", name);
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
        path.join(projectPath, "game.nlproj"),
        encodeProjectConfig({ name, identifier, metadata: {} }),
    );
    return projectPath;
}

async function listAllFiles(root: string): Promise<string[]> {
    const result: string[] = [];
    async function visit(dir: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await visit(full);
            } else {
                result.push(full);
            }
        }
    }
    await visit(root);
    return result;
}

describe("dev mode save IPC handlers", () => {
    beforeEach(async () => {
        forgetProjectStoreIdentifiers();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-dev-save-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("writes, overwrites, reads, lists, and reads preview captures by project", async () => {
        const pathA = await createProject("a", "project-a");
        const pathB = await createProject("b", "project-b");
        const window = createWindow(pathA);
        const windowB = createWindow(pathB);
        const write = new DevModeSaveWriteHandler();
        const read = new DevModeSaveReadHandler();
        const list = new DevModeSaveListIdsHandler();
        const preview = new DevModeSaveReadPreviewHandler();
        const deleteSave = new DevModeSaveDeleteHandler();
        const projectA: DevModeSaveProjectRef = { projectPath: pathA };
        const projectB: DevModeSaveProjectRef = { projectPath: pathB };

        await expect(
            write.handle(window, {
                projectRef: projectA,
                id: "slot 1",
                savedGame: { scene: "intro" },
                capture: "data:image/jpeg;base64,one",
            }),
        ).resolves.toMatchObject({ success: true });
        await expect(
            write.handle(window, {
                projectRef: projectA,
                id: "slot 1",
                savedGame: { scene: "later" },
                capture: "data:image/jpeg;base64,two",
                metadata: ["chapter", 2, { route: "b" }],
            }),
        ).resolves.toMatchObject({ success: true });

        await expect(read.handle(window, { projectRef: projectA, id: "slot 1" })).resolves.toMatchObject({
            success: true,
            data: {
                record: {
                    metadata: {
                        id: "slot 1",
                        type: "save",
                        capture: "data:image/jpeg;base64,two",
                        user: ["chapter", 2, { route: "b" }],
                    },
                    savedGame: { scene: "later" },
                },
            },
        });
        await expect(list.handle(window, { projectRef: projectA })).resolves.toEqual({
            success: true,
            data: { ids: ["slot 1"] },
        });
        await expect(preview.handle(window, { projectRef: projectA, id: "slot 1" })).resolves.toEqual({
            success: true,
            data: { capture: "data:image/jpeg;base64,two" },
        });
        await expect(list.handle(windowB, { projectRef: projectB })).resolves.toEqual({
            success: true,
            data: { ids: [] },
        });

        const filesBeforeDelete = await listAllFiles(path.join(tempDir, UserDataNamespace.DevModeSaves));
        expect(filesBeforeDelete).toHaveLength(1);
        expect(filesBeforeDelete[0]).not.toContain("slot 1");

        await expect(deleteSave.handle(window, { projectRef: projectA, id: "slot 1" })).resolves.toEqual({
            success: true,
            data: { deleted: true },
        });
        await expect(deleteSave.handle(window, { projectRef: projectA, id: "slot 1" })).resolves.toEqual({
            success: true,
            data: { deleted: false },
        });
        await expect(list.handle(window, { projectRef: projectA })).resolves.toEqual({
            success: true,
            data: { ids: [] },
        });
        await expect(read.handle(window, { projectRef: projectA, id: "slot 1" })).resolves.toEqual({
            success: true,
            data: { record: null },
        });

        const files = await listAllFiles(path.join(tempDir, UserDataNamespace.DevModeSaves));
        expect(files).toHaveLength(0);
    });

    it("rejects unsafe ids and skips corrupted files when listing", async () => {
        const projectPath = await createProject("project", "project");
        const window = createWindow(projectPath);
        const write = new DevModeSaveWriteHandler();
        const read = new DevModeSaveReadHandler();
        const list = new DevModeSaveListIdsHandler();
        const deleteSave = new DevModeSaveDeleteHandler();
        const projectRef: DevModeSaveProjectRef = { projectPath };

        await expect(write.handle(window, { projectRef, id: "bad/id", savedGame: {} })).resolves.toMatchObject({
            success: false,
        });
        await expect(read.handle(window, { projectRef, id: ".." })).resolves.toMatchObject({
            success: false,
        });
        await expect(deleteSave.handle(window, { projectRef, id: "../bad" })).resolves.toMatchObject({
            success: false,
        });

        await expect(write.handle(window, { projectRef, id: "good", savedGame: { ok: true } })).resolves.toMatchObject({
            success: true,
        });
        const saveRoot = path.join(tempDir, UserDataNamespace.DevModeSaves);
        const projectDir = (await fs.readdir(saveRoot)).map(name => path.join(saveRoot, name))[0]!;
        await fs.writeFile(path.join(projectDir, "corrupt.dat"), "{", "utf-8");
        await fs.writeFile(
            path.join(projectDir, "unsafe-id.dat"),
            JSON.stringify({
                version: 1,
                metadata: {
                    id: "../escape",
                    type: "save",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
                savedGame: {},
            }),
            "utf-8",
        );

        await expect(list.handle(window, { projectRef })).resolves.toEqual({
            success: true,
            data: { ids: ["good"] },
        });
    });

    /**
     * The store follows the identifier in the project's configuration, not the folder: that is what
     * lets an author move a project without losing the saves they were testing against. Read by the
     * main process off disk, so it holds for every window on the project whatever a request says.
     */
    it("finds a moved project's saves by the identifier in its configuration", async () => {
        const before = await createProject("before", "game.moved");
        const after = await createProject("after", "game.moved");

        await new DevModeSaveWriteHandler().handle(createWindow(before), {
            projectRef: { projectPath: before },
            id: "slot",
            savedGame: { scene: "intro" },
        });

        await expect(new DevModeSaveListIdsHandler().handle(createWindow(after), { projectRef: { projectPath: after } }))
            .resolves.toEqual({ success: true, data: { ids: ["slot"] } });
    });
});
