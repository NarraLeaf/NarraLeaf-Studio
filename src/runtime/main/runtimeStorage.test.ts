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

    it("serves repeat reads from memory and coalesces bursts of writes", async () => {
        const store = new RuntimeSaveStore(tempDir);
        await store.write("slot", { step: 0 });

        const savesDir = path.join(tempDir, "saves");
        const [fileName] = await fs.readdir(savesDir);
        // Corrupt the on-disk file: subsequent reads must come from memory.
        await fs.writeFile(path.join(savesDir, fileName!), "{", "utf-8");
        expect((await store.read("slot"))?.savedGame).toEqual({ step: 0 });
        expect(await store.listIds()).toEqual(["slot"]);

        await Promise.all([
            store.write("slot", { step: 1 }),
            store.write("slot", { step: 2 }),
            store.write("slot", { step: 3 }),
        ]);
        const raw = JSON.parse(await fs.readFile(path.join(savesDir, fileName!), "utf-8"));
        expect(raw.savedGame).toEqual({ step: 3 });
        expect((await store.read("slot"))?.savedGame).toEqual({ step: 3 });
    });

    it("flush persists writes that have not settled yet", async () => {
        const store = new RuntimeSaveStore(tempDir);
        const pending = store.write("slot", { step: 9 });
        expect(store.hasPendingWrites()).toBe(true);
        await store.flush();
        expect(store.hasPendingWrites()).toBe(false);

        const savesDir = path.join(tempDir, "saves");
        const [fileName] = await fs.readdir(savesDir);
        const raw = JSON.parse(await fs.readFile(path.join(savesDir, fileName!), "utf-8"));
        expect(raw.savedGame).toEqual({ step: 9 });
        await pending;
    });

    it("flushes pending persistence mutations and reads back from memory", async () => {
        const store = new RuntimePersistenceStore(tempDir);
        const pending = store.setValue("score", 1);
        expect(store.hasPendingWrites()).toBe(true);
        await store.flush();
        expect(store.hasPendingWrites()).toBe(false);

        const raw = JSON.parse(await fs.readFile(path.join(tempDir, "persistence.json"), "utf-8"));
        expect(raw).toEqual({ score: 1 });
        await pending;

        // Corrupt the file: reads must now come from the in-memory store.
        await fs.writeFile(path.join(tempDir, "persistence.json"), "{", "utf-8");
        expect(await store.getValue("score")).toBe(1);
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
