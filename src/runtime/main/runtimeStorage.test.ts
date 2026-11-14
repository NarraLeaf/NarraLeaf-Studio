import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDevModeBlueprintHostApi } from "../../renderer/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { ScopeStoreBridge } from "../../renderer/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { WidgetRuntimeStateStore } from "../../renderer/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { declaredPersistentDefaults } from "../../shared/variables/mergedPersistentView";
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
        vi.restoreAllMocks();
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

    it("uses separate temporary files for simultaneous writes to the same path", async () => {
        const target = path.join(tempDir, "persistence.json");
        const names: string[] = [];
        let release!: () => void;
        const bothReady = new Promise<void>(resolve => { release = resolve; });
        const rename = async (from: string, to: string) => {
            names.push(from);
            if (names.length === 2) release();
            await bothReady;
            await fs.rename(from, to);
        };
        vi.spyOn(Date, "now").mockReturnValue(123456789);
        const results = await Promise.allSettled([
            atomicWriteJson(target, { chapter: 1 }, rename),
            atomicWriteJson(target, { chapter: 2 }, rename),
        ]);
        expect(new Set(names).size).toBe(2);
        expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
        expect([1, 2]).toContain(JSON.parse(await fs.readFile(target, "utf-8")).chapter);
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

    it("keeps the last of concurrent writes when a slot is first loaded", async () => {
        const store = new RuntimeSaveStore(tempDir);
        const missing = Object.assign(new Error("missing save"), { code: "ENOENT" });
        let releaseFirst!: () => void;
        let firstStarted!: () => void;
        let secondStarted!: () => void;
        const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
        const firstRead = new Promise<void>(resolve => { firstStarted = resolve; });
        const secondRead = new Promise<void>(resolve => { secondStarted = resolve; });
        let reads = 0;
        const spy = vi.spyOn(fs, "readFile").mockImplementation((async (file: Parameters<typeof fs.readFile>[0]) => {
            if (typeof file === "string" && path.dirname(file) === path.join(tempDir, "saves")) {
                reads++;
                if (reads === 1) {
                    firstStarted();
                    await firstGate;
                } else {
                    secondStarted();
                }
                throw missing;
            }
            throw new Error(`Unexpected read: ${String(file)}`);
        }) as typeof fs.readFile);

        const older = store.write("slot", { step: 1 });
        await firstRead;
        const newer = store.write("slot", { step: 2 });
        await Promise.race([secondRead, new Promise<void>(resolve => setImmediate(resolve))]);
        if (reads > 1) await newer;
        releaseFirst();
        await Promise.all([older, newer]);
        spy.mockRestore();

        expect((await new RuntimeSaveStore(tempDir).read("slot"))?.savedGame).toEqual({ step: 2 });
    });

    it("preserves an existing save when its initial disk read fails", async () => {
        await new RuntimeSaveStore(tempDir).write("slot", { step: 1 });
        const store = new RuntimeSaveStore(tempDir);
        const failure = Object.assign(new Error("disk read failed"), { code: "EIO" });
        const read = vi.spyOn(fs, "readFile").mockRejectedValueOnce(failure);

        await expect(store.write("slot", { step: 2 })).rejects.toMatchObject({ code: "EIO" });
        read.mockRestore();
        expect((await new RuntimeSaveStore(tempDir).read("slot"))?.savedGame).toEqual({ step: 1 });
        await store.write("slot", { step: 3 });
        expect((await new RuntimeSaveStore(tempDir).read("slot"))?.savedGame).toEqual({ step: 3 });
    });

    it("reads the last persisted save after an overwrite fails", async () => {
        const store = new RuntimeSaveStore(tempDir);
        await store.write("slot", { step: 1 });
        const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
        const rename = vi.spyOn(fs, "rename").mockRejectedValueOnce(failure);

        await expect(store.write("slot", { step: 2 })).rejects.toMatchObject({ code: "ENOSPC" });
        rename.mockRestore();
        expect((await store.read("slot"))?.savedGame).toEqual({ step: 1 });
        await store.write("slot", { step: 3 });
        expect((await new RuntimeSaveStore(tempDir).read("slot"))?.savedGame).toEqual({ step: 3 });
    });

    it("keeps a save visible when deleting its file fails", async () => {
        const store = new RuntimeSaveStore(tempDir);
        await store.write("slot", { step: 1 });
        const failure = Object.assign(new Error("delete denied"), { code: "EACCES" });
        const unlink = vi.spyOn(fs, "unlink").mockRejectedValueOnce(failure);

        await expect(store.delete("slot")).rejects.toMatchObject({ code: "EACCES" });
        unlink.mockRestore();
        expect((await store.read("slot"))?.savedGame).toEqual({ step: 1 });
        expect(await store.delete("slot")).toEqual({ deleted: true });
        expect(await new RuntimeSaveStore(tempDir).read("slot")).toBeNull();
    });

    it("fulfils queued writes when a newer save persists after an earlier failure", async () => {
        const store = new RuntimeSaveStore(tempDir);
        await store.write("slot", { step: 0 });
        const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
        let release!: () => void;
        let started!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const firstRename = new Promise<void>(resolve => { started = resolve; });
        const rename = vi.spyOn(fs, "rename").mockImplementationOnce(async () => {
            started();
            await gate;
            throw failure;
        });

        const older = store.write("slot", { step: 1 });
        await firstRename;
        const newer = store.write("slot", { step: 2 });
        const both = Promise.all([older, newer]);
        release();
        await expect(both).resolves.toEqual([undefined, undefined]);
        rename.mockRestore();
        expect((await new RuntimeSaveStore(tempDir).read("slot"))?.savedGame).toEqual({ step: 2 });
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

    it("drains a failed write while reporting the failure to its caller", async () => {
        const store = new RuntimeSaveStore(tempDir);
        const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
        vi.spyOn(fs, "rename").mockRejectedValueOnce(failure);
        const pending = store.write("slot", { step: 1 });
        const result = expect(pending).rejects.toMatchObject({ code: "ENOSPC" });

        await expect(store.flush()).resolves.toBeUndefined();
        await result;
        expect(store.hasPendingWrites()).toBe(false);
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

    it("retries loading persistent values after the file becomes readable", async () => {
        const file = path.join(tempDir, "persistence.json");
        await fs.writeFile(file, "{", "utf-8");
        const store = new RuntimePersistenceStore(tempDir);

        await expect(store.getValue("score")).rejects.toThrow();
        await fs.writeFile(file, JSON.stringify({ score: 42 }), "utf-8");

        expect(await store.getValue("score")).toBe(42);
        await store.setValue("score", 43);
        expect(JSON.parse(await fs.readFile(file, "utf-8"))).toEqual({ score: 43 });
    });

    it("fulfils queued persistence mutations when a later write succeeds", async () => {
        const store = new RuntimePersistenceStore(tempDir);
        const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
        let release!: () => void;
        let started!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const firstRename = new Promise<void>(resolve => { started = resolve; });
        const rename = vi.spyOn(fs, "rename").mockImplementationOnce(async () => {
            started();
            await gate;
            throw failure;
        });

        const first = store.setValue("score", 1);
        await firstRename;
        const second = store.setValue("level", 2);
        const both = Promise.all([first, second]);
        release();
        await expect(both).resolves.toEqual([undefined, undefined]);
        rename.mockRestore();
        expect(await new RuntimePersistenceStore(tempDir).getAll()).toEqual({ score: 1, level: 2 });
    });

    it("keeps a rejected persistence mutation in memory for a later retry", async () => {
        const store = new RuntimePersistenceStore(tempDir);
        await store.setValue("score", 1);
        const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
        const rename = vi.spyOn(fs, "rename").mockRejectedValueOnce(failure);

        await expect(store.setValue("score", 2)).rejects.toMatchObject({ code: "ENOSPC" });
        rename.mockRestore();
        expect(await store.getValue("score")).toBe(2);
        expect(await new RuntimePersistenceStore(tempDir).getValue("score")).toBe(1);
        await store.setValue("level", 3);
        expect(await new RuntimePersistenceStore(tempDir).getAll()).toEqual({ score: 2, level: 3 });
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

    it.each(["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"])(
        "treats an unwritten %s key as absent",
        async key => {
            const store = new RuntimePersistenceStore(tempDir);

            expect(await store.getValue(key)).toBeUndefined();
            expect(Object.prototype.hasOwnProperty.call(await store.getAll(), key)).toBe(false);
        },
    );

    it.each<[string, unknown]>([
        ["__proto__", 0],
        ["__proto__", { completed: true }],
        ["constructor", false],
        ["prototype", { level: 2 }],
        ["toString", "chapter"],
        ["hasOwnProperty", null],
    ])("persists and removes the %s key with value %j", async (key, value) => {
        const store = new RuntimePersistenceStore(tempDir);
        await store.setValue(key, value);

        expect(await store.getValue(key)).toEqual(value);
        expect(await store.getAll()).toEqual(Object.fromEntries([[key, value]]));
        const disk = JSON.parse(await fs.readFile(path.join(tempDir, "persistence.json"), "utf-8"));
        expect(Object.prototype.hasOwnProperty.call(disk, key)).toBe(true);
        expect(disk[key]).toEqual(value);

        const reopened = new RuntimePersistenceStore(tempDir);
        expect(await reopened.getValue(key)).toEqual(value);
        await reopened.removeValue(key);
        expect(await reopened.getValue(key)).toBeUndefined();
        expect(await new RuntimePersistenceStore(tempDir).getValue(key)).toBeUndefined();
    });

    it("updates and clears a special key in an existing persistence file", async () => {
        const file = path.join(tempDir, "persistence.json");
        await fs.writeFile(file, JSON.stringify(Object.fromEntries([["__proto__", 1], ["score", 2]])), "utf-8");
        const store = new RuntimePersistenceStore(tempDir);

        expect(await store.getValue("__proto__")).toBe(1);
        await store.setValue("__proto__", { chapter: 3 });
        expect((await new RuntimePersistenceStore(tempDir).getAll())).toEqual(
            Object.fromEntries([["__proto__", { chapter: 3 }], ["score", 2]]),
        );
        await store.setValue("__proto__", undefined);
        expect(await new RuntimePersistenceStore(tempDir).getAll()).toEqual({ score: 2 });
    });

    it("round-trips a script persistence key through the runtime scope and desktop store", async () => {
        const defaults = declaredPersistentDefaults({
            ui: {
                persistentVariables: {
                    progress: {
                        id: "progress",
                        name: "Progress",
                        scope: "persistent",
                        valueType: "number",
                        storageKey: "__proto__",
                        defaultValue: 7,
                    },
                },
            },
        });
        const scope = new ScopeStoreBridge({ persistentDefaults: defaults });
        scope.setPersistenceAdapter(new RuntimePersistenceStore(tempDir));
        await scope.reloadPersistenceSnapshot();
        const host = createDevModeBlueprintHostApi({
            document: { surfaces: [], elements: {} },
            scope,
            activeSurfaceId: "title",
            emit: () => undefined,
            onOpenSurface: () => undefined,
            onPageBack: () => undefined,
            onWidgetPatch: () => undefined,
            widgetRuntimeStore: new WidgetRuntimeStateStore(),
        } as unknown as Parameters<typeof createDevModeBlueprintHostApi>[0]);

        expect(await host.persistence.get("__proto__")).toBe(7);
        expect(await scope.persistenceStoredAsync("__proto__")).toBeUndefined();
        await expect(fs.access(path.join(tempDir, "persistence.json"))).rejects.toMatchObject({ code: "ENOENT" });

        await host.persistence.set("__proto__", 42);
        const reloaded = new ScopeStoreBridge({ persistentDefaults: defaults });
        reloaded.setPersistenceAdapter(new RuntimePersistenceStore(tempDir));
        await reloaded.reloadPersistenceSnapshot();
        expect(await reloaded.persistenceGetAsync("__proto__")).toBe(42);
        expect(await reloaded.persistenceStoredAsync("__proto__")).toBe(42);

        await reloaded.persistenceSet("__proto__", undefined);
        expect(await reloaded.persistenceGetAsync("__proto__")).toBe(7);
        expect(await reloaded.persistenceStoredAsync("__proto__")).toBeUndefined();
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

    it("leaves unrelated old temporary files in the game folder", async () => {
        const names = ["download.tmp", "settings.json.1234.1700000000000.tmp"];
        const old = Date.now() - ABANDONED_TEMP_FILE_AGE_MS - 1000;
        for (const name of names) {
            const file = path.join(tempDir, name);
            await fs.writeFile(file, "player data", "utf-8");
            await fs.utimes(file, new Date(old), new Date(old));
        }

        expect(await sweepAbandonedTempFiles(tempDir)).toEqual([]);
        for (const name of names) {
            expect(await fs.readFile(path.join(tempDir, name), "utf-8")).toBe("player data");
        }
    });

    it("removes abandoned save temp files named by the save store", async () => {
        const name = `${"a".repeat(64)}.json.1234.1700000000000.tmp`;
        const file = path.join(tempDir, name);
        await fs.writeFile(file, "{}", "utf-8");
        const old = Date.now() - ABANDONED_TEMP_FILE_AGE_MS - 1000;
        await fs.utimes(file, new Date(old), new Date(old));

        expect(await sweepAbandonedTempFiles(tempDir)).toEqual([name]);
    });

    it("removes abandoned uniquely named temp files", async () => {
        const name = "persistence.json.1234.1700000000000.0123456789abcdef.tmp";
        const file = path.join(tempDir, name);
        await fs.writeFile(file, "{}", "utf-8");
        const old = Date.now() - ABANDONED_TEMP_FILE_AGE_MS - 1000;
        await fs.utimes(file, new Date(old), new Date(old));
        expect(await sweepAbandonedTempFiles(tempDir)).toEqual([name]);
    });

    it("says nothing and does nothing when there is no such directory", async () => {
        // A game whose saves directory does not exist yet still has to boot.
        expect(await sweepAbandonedTempFiles(path.join(tempDir, "saves"))).toEqual([]);
    });
});
