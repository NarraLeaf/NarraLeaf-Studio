import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { Services, type WorkspaceContext } from "../services";
import { VariableRegistryService } from "./VariableRegistryService";

const ROOT = join("D:/projects", "my-game");
const DOCUMENT = join(ROOT, "editor", "variables.json");

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

async function createHarness() {
    const files = new Map<string, string>();
    let nextId = 0;
    let failWrite = false;
    let nextWrite: { started: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
    const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => {
                const value = files.get(path);
                return value === undefined
                    ? { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }
                    : ok(value);
            },
            writeFileNoFollowOrCreate: async (path: string, data: string) => {
                const paused = nextWrite;
                nextWrite = null;
                if (paused) {
                    paused.started.resolve();
                    await paused.release.promise;
                }
                if (failWrite) {
                    failWrite = false;
                    return { ok: false, error: { code: FsRejectErrorCode.IO_ERROR, message: "disk error" } } as const;
                }
                files.set(path, data);
                return ok(undefined);
            },
            createDir: async () => ok(undefined),
            copyFile: async (src: string, dest: string) => {
                files.set(dest, files.get(src) ?? "");
                return ok(undefined);
            },
        },
        [Services.Project]: {},
        [Services.Uuid]: { generate: () => `var-${++nextId}` },
        [Services.UIGraph]: {},
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: vi.fn() },
    };
    const context = {
        project: { getConfig: () => ({ projectPath: ROOT }) },
        services: { get: (id: string) => stubs[id] },
    } as unknown as WorkspaceContext;
    const service = new VariableRegistryService();
    await service.initialize(context, async () => undefined);
    const entry = service.createEntry("saved", { name: "Gold" });
    await service.flushPendingChanges();
    return {
        service,
        entry,
        savedName: () => JSON.parse(files.get(DOCUMENT)!).entries[entry.id].name as string,
        failNextWrite: () => { failWrite = true; },
        pauseNextWrite: () => {
            const paused = { started: deferred(), release: deferred() };
            nextWrite = paused;
            return paused;
        },
    };
}

describe("variable registry saves", () => {
    it("keeps a history restore made while a save is writing and saves the restored registry", async () => {
        const { service, entry, savedName, pauseNextWrite } = await createHarness();
        service.renameEntry(entry.id, "Before undo");
        const paused = pauseNextWrite();
        const saving = service.save(service.getRegistry());
        await paused.started.promise;

        const restored = structuredClone(service.getRegistry());
        restored.entries[entry.id].name = "After undo";
        service.replaceRegistry(restored);
        paused.release.resolve();
        await saving;

        expect(service.getEntry(entry.id)?.name).toBe("After undo");
        expect(service.isDirty()).toBe(true);
        await service.flushPendingChanges();
        expect(savedName()).toBe("After undo");
        expect(service.isDirty()).toBe(false);
    });

    it("serializes overlapping manual saves so an older write cannot finish last", async () => {
        const { service, entry, savedName, pauseNextWrite } = await createHarness();
        service.renameEntry(entry.id, "First");
        const paused = pauseNextWrite();
        const first = service.save(service.getRegistry());
        await paused.started.promise;

        service.renameEntry(entry.id, "Second");
        const second = service.save(service.getRegistry());
        await Promise.race([second, new Promise(resolve => setTimeout(resolve, 20))]);
        paused.release.resolve();
        await Promise.all([first, second]);

        expect(service.getEntry(entry.id)?.name).toBe("Second");
        expect(savedName()).toBe("Second");
        expect(service.isDirty()).toBe(false);
    });

    it("keeps a later in-place edit dirty until its own write completes", async () => {
        const { service, entry, savedName, pauseNextWrite } = await createHarness();
        service.renameEntry(entry.id, "First");
        const paused = pauseNextWrite();
        const saving = service.save(service.getRegistry());
        await paused.started.promise;

        service.renameEntry(entry.id, "Second");
        paused.release.resolve();
        await saving;
        expect(service.getEntry(entry.id)?.name).toBe("Second");
        expect(service.isDirty()).toBe(true);
        expect(savedName()).toBe("First");
        await service.flushPendingChanges();
        expect(savedName()).toBe("Second");
        expect(service.isDirty()).toBe(false);
    });

    it("keeps a failed manual save available for a later flush", async () => {
        const { service, entry, savedName, failNextWrite } = await createHarness();
        service.renameEntry(entry.id, "Coins");
        failNextWrite();
        await expect(service.save(service.getRegistry())).rejects.toThrow("disk error");
        expect(service.isDirty()).toBe(true);
        expect(savedName()).toBe("Gold");
        await service.flushPendingChanges();
        expect(savedName()).toBe("Coins");
        expect(service.isDirty()).toBe(false);
    });

    it("makes a flush wait for a manual save that is already writing", async () => {
        const { service, entry, pauseNextWrite } = await createHarness();
        service.renameEntry(entry.id, "Coins");
        const paused = pauseNextWrite();
        const saving = service.save(service.getRegistry());
        await paused.started.promise;

        let flushed = false;
        const flush = service.flushPendingChanges().then(() => { flushed = true; });
        await new Promise(resolve => setTimeout(resolve, 0));
        const flushedBeforeRelease = flushed;
        paused.release.resolve();
        await Promise.all([saving, flush]);
        expect(flushedBeforeRelease).toBe(false);
    });
});
