import { afterEach, describe, expect, it, vi } from "vitest";
import { WebGameStorage } from "./webStorage";

function storedSave(id: string) {
    return {
        version: 1,
        metadata: { id, type: "save", createdAt: "first", updatedAt: "last" },
        savedGame: { scene: "start" },
    };
}

/** A database that completes transactions asynchronously, as IndexedDB does. */
function installSaveDatabase(entries: Array<[string, unknown]>, failedOpens = 0) {
    const stores = new Map([
        ["saves", new Map(entries)],
        ["persistence", new Map<string, unknown>()],
    ]);
    const database = {
        transaction: (name: string) => {
            const store = stores.get(name)!;
            const transaction = {
                oncomplete: null as (() => void) | null,
                onabort: null as (() => void) | null,
                onerror: null as (() => void) | null,
                error: null,
                objectStore: () => ({
                    get: (key: string) => ({ result: store.get(key) }),
                    getAll: () => ({ result: [...store.values()] }),
                    getAllKeys: () => ({ result: [...store.keys()] }),
                    put: (value: unknown, key: string) => {
                        store.set(key, value);
                        return { result: key };
                    },
                }),
            };
            queueMicrotask(() => transaction.oncomplete?.());
            return transaction;
        },
    };
    vi.stubGlobal("indexedDB", {
        open: () => {
            const fail = failedOpens > 0;
            failedOpens -= Number(fail);
            const request = {
                result: database,
                error: new DOMException("Temporary storage failure", "UnknownError"),
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
            };
            queueMicrotask(() => {
                if (fail) {
                    request.onerror?.();
                } else {
                    request.onsuccess?.();
                }
            });
            return request;
        },
    });
}

afterEach(() => vi.unstubAllGlobals());

describe("WebGameStorage", () => {
    it("keeps a malformed save from hiding the other save headers", async () => {
        installSaveDatabase([
            ["broken", storedSave("bad/id")],
            ["good", storedSave("good")],
        ]);
        const storage = new WebGameStorage("game");

        await expect(storage.listSaveHeaders()).resolves.toEqual([
            { id: "good", createdAt: "first", updatedAt: "last" },
        ]);
        await expect(storage.readSave("broken")).resolves.toBeNull();
    });

    it("can overwrite a slot whose stored metadata is malformed", async () => {
        installSaveDatabase([["slot", storedSave("bad/id")]]);
        const storage = new WebGameStorage("game");

        await storage.writeSave("slot", { scene: "new" });
        expect(await storage.readSave("slot")).toMatchObject({
            metadata: { id: "slot" },
            savedGame: { scene: "new" },
        });
    });

    it("includes a persistent key named __proto__ when restoring all values", async () => {
        installSaveDatabase([]);
        const storage = new WebGameStorage("game");
        await storage.setPersistenceValue("__proto__", { completed: true });

        const values = await storage.getAllPersistence();
        expect(Object.hasOwn(values, "__proto__")).toBe(true);
        expect(values["__proto__"]).toEqual({ completed: true });
        expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    });

    it("can use storage after a temporary database open failure", async () => {
        installSaveDatabase([], 1);
        const storage = new WebGameStorage("game");

        await expect(storage.getPersistenceValue("coins")).rejects.toThrow("Temporary storage failure");
        await storage.setPersistenceValue("coins", 7);
        await expect(storage.getPersistenceValue("coins")).resolves.toBe(7);
    });
});
