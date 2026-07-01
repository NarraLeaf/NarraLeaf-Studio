import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserDataNamespace } from "@shared/types/constants";
import type { DevModeSaveProjectRef } from "@shared/types/devModeSave";
import type { AppWindow } from "../appWindow";
import {
    DevModeSaveListIdsHandler,
    DevModeSaveReadHandler,
    DevModeSaveReadPreviewHandler,
    DevModeSaveWriteHandler,
} from "./devModeSaveAction";

let tempDir = "";

function createWindow(): AppWindow {
    return {
        app: {
            storageManager: {
                getNamespacePath(namespace: UserDataNamespace) {
                    return path.join(tempDir, namespace);
                },
            },
        },
    } as unknown as AppWindow;
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
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-dev-save-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("writes, overwrites, reads, lists, and reads preview captures by project", async () => {
        const window = createWindow();
        const write = new DevModeSaveWriteHandler();
        const read = new DevModeSaveReadHandler();
        const list = new DevModeSaveListIdsHandler();
        const preview = new DevModeSaveReadPreviewHandler();
        const projectA: DevModeSaveProjectRef = { projectIdentifier: "project-a", projectPath: "/tmp/project" };
        const projectB: DevModeSaveProjectRef = { projectIdentifier: "project-b", projectPath: "/tmp/project" };

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
        await expect(list.handle(window, { projectRef: projectB })).resolves.toEqual({
            success: true,
            data: { ids: [] },
        });

        const files = await listAllFiles(path.join(tempDir, UserDataNamespace.DevModeSaves));
        expect(files).toHaveLength(1);
        expect(files[0]).not.toContain("slot 1");
    });

    it("rejects unsafe ids and skips corrupted files when listing", async () => {
        const window = createWindow();
        const write = new DevModeSaveWriteHandler();
        const read = new DevModeSaveReadHandler();
        const list = new DevModeSaveListIdsHandler();
        const projectRef: DevModeSaveProjectRef = { projectPath: "/tmp/project" };

        await expect(write.handle(window, { projectRef, id: "bad/id", savedGame: {} })).resolves.toMatchObject({
            success: false,
        });
        await expect(read.handle(window, { projectRef, id: ".." })).resolves.toMatchObject({
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
});
