import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuntimePersistenceStore, RuntimeSaveStore, normalizeRuntimeSaveId } from "./runtimeStorage";

let tempDir = "";

describe("runtime save and persistence storage", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-runtime-store-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("normalizes save ids without allowing path segments", () => {
        expect(normalizeRuntimeSaveId(" slot 1 ")).toBe("slot 1");
        expect(() => normalizeRuntimeSaveId("")).toThrow(/required/);
        expect(() => normalizeRuntimeSaveId("bad/id")).toThrow(/path segment/);
        expect(() => normalizeRuntimeSaveId("..")).toThrow(/path segment/);
    });

    it("writes, overwrites, lists, previews, and deletes save records", async () => {
        const store = new RuntimeSaveStore(tempDir);

        await store.write("slot 1", { scene: "intro" }, "data:image/png;base64,one");
        const first = await store.read("slot 1");
        await store.write("slot 1", { scene: "later" }, "data:image/png;base64,two", { route: "b" });
        const second = await store.read("slot 1");

        expect(first?.metadata.createdAt).toBeTruthy();
        expect(second).toMatchObject({
            metadata: {
                id: "slot 1",
                type: "save",
                capture: "data:image/png;base64,two",
                user: { route: "b" },
            },
            savedGame: { scene: "later" },
        });
        expect(second?.metadata.createdAt).toBe(first?.metadata.createdAt);
        expect(await store.listIds()).toEqual(["slot 1"]);
        expect(await store.readPreview("slot 1")).toBe("data:image/png;base64,two");

        const files = await fs.readdir(path.join(tempDir, "saves"));
        expect(files).toHaveLength(1);
        expect(files[0]).not.toContain("slot 1");

        await fs.writeFile(path.join(tempDir, "saves", "corrupt.json"), "{", "utf-8");
        expect(await store.listIds()).toEqual(["slot 1"]);

        expect(await store.delete("slot 1")).toEqual({ deleted: true });
        expect(await store.delete("slot 1")).toEqual({ deleted: false });
        expect(await store.read("slot 1")).toBeNull();
        expect(await store.listIds()).toEqual([]);
    });

    it("stores blueprint persistence values as JSON", async () => {
        const store = new RuntimePersistenceStore(tempDir);

        expect(await store.getAll()).toEqual({});
        await store.setValue("score", 42);
        await store.setValue("profile", { name: "Ada", nested: ["ok"] });
        await store.setValue("bad", () => undefined);

        expect(await store.getValue("score")).toBe(42);
        expect(await store.getAll()).toEqual({
            score: 42,
            profile: { name: "Ada", nested: ["ok"] },
            bad: null,
        });

        await store.setValue("bad", undefined);
        await store.removeValue("score");
        expect(await store.getAll()).toEqual({
            profile: { name: "Ada", nested: ["ok"] },
        });
    });
});
