import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ABANDONED_TEMP_FILE_AGE_MS,
    RuntimePersistenceStore,
    RuntimeSaveStore,
    atomicWriteJson,
    normalizeRuntimeSaveId,
    sweepAbandonedTempFiles,
} from "./runtimeStorage";

let tempDir = "";

describe("runtime save and persistence storage", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-runtime-store-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    // A machine that refuses the rename is not hypothetical: a sync client or a scanner holding the
    // destination answers EPERM, and a redirected profile answers EXDEV between two siblings. Before
    // the fallback, every save and every persistent variable after the first refusal was lost, and
    // the only sign was an unhandled rejection in a log the player never opens.
    it("still writes the file when the filesystem refuses the atomic rename", async () => {
        const target = path.join(tempDir, "persistence.json");
        const refusal = Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
        const refuse = vi.fn(async () => { throw refusal; });

        await atomicWriteJson(target, { chapter: 3 }, refuse);

        expect(refuse).toHaveBeenCalledTimes(1);
        expect(JSON.parse(await fs.readFile(target, "utf-8"))).toEqual({ chapter: 3 });
        expect((await fs.readdir(tempDir)).filter(name => name.endsWith(".tmp"))).toEqual([]);
    });

    it("reports a refusal the fallback is not for", async () => {
        const target = path.join(tempDir, "persistence.json");
        const refusal = Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });

        await expect(atomicWriteJson(target, { chapter: 3 }, async () => { throw refusal; }))
            .rejects.toThrow(/ENOSPC/);
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

describe("sweepAbandonedTempFiles", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-runtime-sweep-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("removes what an interrupted write left behind and nothing else", async () => {
        // A language change ends the process on purpose, so a write caught mid-rename is now a
        // routine event rather than a crash artefact.
        const abandoned = path.join(tempDir, "persistence.json.1234.1700000000000.tmp");
        await fs.writeFile(abandoned, "{}", "utf-8");
        const old = Date.now() - ABANDONED_TEMP_FILE_AGE_MS - 1000;
        await fs.utimes(abandoned, new Date(old), new Date(old));
        await fs.writeFile(path.join(tempDir, "persistence.json"), "{}", "utf-8");

        const removed = await sweepAbandonedTempFiles(tempDir);

        expect(removed).toEqual(["persistence.json.1234.1700000000000.tmp"]);
        expect(await fs.readdir(tempDir)).toEqual(["persistence.json"]);
    });

    it("leaves a temp file another copy of the game is writing right now", async () => {
        // Two instances of the same title can share a user data directory, and the other one's
        // temp file is milliseconds old. Deleting it would take away the write it is in the
        // middle of.
        const inFlight = path.join(tempDir, "persistence.json.9999.1700000000001.tmp");
        await fs.writeFile(inFlight, "{}", "utf-8");

        expect(await sweepAbandonedTempFiles(tempDir)).toEqual([]);
        expect(await fs.readdir(tempDir)).toEqual([path.basename(inFlight)]);
    });

    it("says nothing and does nothing when there is no such directory", async () => {
        // A game whose saves directory does not exist yet still has to boot.
        expect(await sweepAbandonedTempFiles(path.join(tempDir, "saves"))).toEqual([]);
    });
});
