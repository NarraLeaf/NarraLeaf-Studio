import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { thawProjectWrites } from "@/lib/app/writeFreeze";
import { BaseFileSystemService } from "./FileSystem";
import { WorkspaceFreezeService } from "./WorkspaceFreezeService";
import { Services, type WorkspaceContext } from "../services";

/**
 * The service and the boundary it arms, together.
 *
 * The assertions are deliberately made through the REAL `BaseFileSystemService` and the real
 * privileged facade rather than against the latch's predicate: the milestone's claim is that a write
 * cannot reach the disk while frozen, and a test that only asked the predicate would keep passing if
 * somebody added a write path that never consulted it. What is checked is that the host is never
 * called at all.
 */

const PROJECT = "D:/projects/my-game";

const privilegedFs = vi.hoisted(() => ({
    requestWrite: vi.fn(),
    requestWriteRaw: vi.fn(),
    copyFile: vi.fn(),
    deleteFile: vi.fn(),
    createDir: vi.fn(),
    ensureRegularFile: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({ fs: privilegedFs }),
}));

const flushAll = vi.fn(async () => undefined);
const reload = vi.fn(async () => ({ cause: "thaw" as const, reloaded: [], failures: [] }));
const fetchMock = vi.fn(async () => ({ ok: true, statusText: "OK" }));

function createContext(): WorkspaceContext {
    return {
        project: { getConfig: () => ({ projectPath: PROJECT }) },
        services: {
            get: (id: string) => (id === Services.WorkspaceReload ? { reload } : { flushAll }),
        },
    } as unknown as WorkspaceContext;
}

async function createService(): Promise<WorkspaceFreezeService> {
    const service = new WorkspaceFreezeService();
    await service.initialize(createContext(), async () => undefined);
    return service;
}

beforeEach(() => {
    for (const fn of Object.values(privilegedFs)) {
        fn.mockReset();
        fn.mockResolvedValue({ success: true, data: { ok: true, data: "hash" } });
    }
    flushAll.mockClear();
    reload.mockClear();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    thawProjectWrites();
    vi.unstubAllGlobals();
});

describe("WorkspaceFreezeService", () => {
    it("starts writable and reports no reason", async () => {
        const service = await createService();

        expect(service.isFrozen()).toBe(false);
        expect(service.getReason()).toBeNull();
    });

    it("blocks a versioned write without reaching the host", async () => {
        const service = await createService();
        await service.freeze({ kind: "revision", revision: "aa", label: "#12" });

        const result = await BaseFileSystemService.write(`${PROJECT}/editor/story/index.json`, "{}", "utf-8");

        expect(result.ok).toBe(true);
        expect(privilegedFs.requestWrite).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(service.getReason()).toEqual({ kind: "revision", revision: "aa", label: "#12" });
    });

    it("blocks the write paths that skip FileSystemService, which is where asset import lives", async () => {
        const service = await createService();
        await service.freeze({ kind: "manual" });

        const { appPrivilegedFacade } = await import("@/lib/app/privilegedFacade");
        await appPrivilegedFacade.fs.copyFile("C:/downloads/sprite.png", `${PROJECT}/assets/content/ab/cd/sprite.png`);
        await appPrivilegedFacade.fs.deleteFile(`${PROJECT}/assets/content/ab/cd/sprite.png`);

        expect(privilegedFs.copyFile).not.toHaveBeenCalled();
        expect(privilegedFs.deleteFile).not.toHaveBeenCalled();
        expect(service.isFrozen()).toBe(true);
    });

    /**
     * The half of the rule a later change is most likely to break. Editor state lives inside the
     * project directory too, and freezing it would look to the author like the whole application had
     * stopped working - which is why the boundary is `isVersioned` and not "the project folder".
     */
    it("leaves writes to non-versioned paths completely alone while frozen", async () => {
        const service = await createService();
        await service.freeze({ kind: "manual" });

        const layout = await BaseFileSystemService.write(`${PROJECT}/.nlstudio/editor.json`, "{}", "utf-8");
        const thumbnail = await BaseFileSystemService.writeRaw(
            `${PROJECT}/editor/cache/thumbnail/ab/cd/asset-1.png`,
            new Uint8Array([1]),
        );

        expect(layout.ok).toBe(true);
        expect(thumbnail.ok).toBe(true);
        expect(privilegedFs.requestWrite).toHaveBeenCalledTimes(1);
        expect(privilegedFs.requestWriteRaw).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(service.isFrozen()).toBe(true);
    });

    it("restores writes on thaw", async () => {
        const service = await createService();
        await service.freeze({ kind: "manual" });
        await BaseFileSystemService.write(`${PROJECT}/project.json`, "{}", "utf-8");
        expect(privilegedFs.requestWrite).not.toHaveBeenCalled();

        service.thaw();

        await BaseFileSystemService.write(`${PROJECT}/project.json`, "{}", "utf-8");
        expect(privilegedFs.requestWrite).toHaveBeenCalledTimes(1);
        expect(service.isFrozen()).toBe(false);
        expect(service.getReason()).toBeNull();
    });

    /**
     * The other half of the fix. A refused write is a no-op, so whatever tried it kept the value in
     * memory - measured: a scene created while frozen never reached disk, then rode the first save
     * after thawing there. Without this the freeze does not prevent the loss, it postpones it.
     */
    it("re-reads the working tree on thaw, exactly once", async () => {
        const service = await createService();
        await service.freeze({ kind: "revision", revision: "aa" });

        service.thaw();

        expect(reload).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledWith("thaw");
    });

    it("does not reload when there was nothing to leave", async () => {
        const service = await createService();

        // A thaw is still a thaw when no freeze was armed, but re-reading the whole project for it
        // would throw away undo history and remount every tab for nothing.
        service.thaw();

        expect(reload).not.toHaveBeenCalled();
    });

    it("flushes what is owed before freezing, so a pending save is not silently dropped", async () => {
        const service = await createService();

        await service.freeze({ kind: "manual" });

        // A refused write is a no-op, not an error - anything a saver still owed at the moment of
        // freezing would simply vanish, which is the author's own last edit.
        expect(flushAll).toHaveBeenCalledTimes(1);
    });

    it("notifies subscribers on both edges", async () => {
        const service = await createService();
        const seen: (string | null)[] = [];
        const stop = service.onChanged(reason => seen.push(reason?.kind ?? null));

        await service.freeze({ kind: "manual" });
        service.thaw();

        expect(seen).toEqual(["manual", null]);
        stop();
    });

    /**
     * Session-only, and provably so: freezing touches no storage of any kind, and a workspace that
     * comes back up is writable. A freeze that outlived a restart would be a project that refuses to
     * save with nothing on screen to say why.
     */
    it("never persists, and a re-opened workspace is writable", async () => {
        const service = await createService();
        await service.freeze({ kind: "revision", revision: "aa" });

        // Nothing was written to say so.
        expect(privilegedFs.requestWrite).not.toHaveBeenCalled();
        expect(privilegedFs.requestWriteRaw).not.toHaveBeenCalled();
        expect(privilegedFs.ensureRegularFile).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();

        await service.teardown(service.getContext());
        await service.initialize(createContext(), async () => undefined);

        expect(service.isFrozen()).toBe(false);
        await BaseFileSystemService.write(`${PROJECT}/project.json`, "{}", "utf-8");
        expect(privilegedFs.requestWrite).toHaveBeenCalledTimes(1);
    });
});
