import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestStatus } from "@shared/types/ipcEvents";
import type { VcsAvailability, VcsStatus } from "@shared/types/vcs";
import { VersionControlService } from "./VersionControlService";
import type { WorkspaceContext } from "../services";

/**
 * The service against a faked bridge - no native library, no repository on disk.
 *
 * The assertions worth having here are about WHEN it talks to the host, not about
 * what the host says. Availability must be asked once because the probe dlopens a
 * ~29MB library, and status must be scanned only when someone asks, because the scan
 * writes staged state and a repeated one invents deletions the author never made
 * (docs/version-control.md §4.17). Both are call-count assertions.
 */

const vcs = vi.hoisted(() => ({
    getAvailability: vi.fn(),
    isRepository: vi.fn(),
    getInfo: vi.fn(),
    initRepository: vi.fn(),
    getStatus: vi.fn(),
    getHistory: vi.fn(),
    readBlob: vi.fn(),
    getChangedPaths: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ vcs }),
}));

const PROJECT = "D:/projects/demo";

function ok<T>(data: T): Promise<RequestStatus<T>> {
    return Promise.resolve({ success: true, data });
}

function createContext(): WorkspaceContext {
    return {
        project: { getConfig: () => ({ projectPath: PROJECT }) },
        services: {
            get: () => {
                throw new Error("Unexpected service lookup in test");
            },
        },
    } as unknown as WorkspaceContext;
}

async function createService(availability: VcsAvailability = { available: true }): Promise<VersionControlService> {
    vcs.getAvailability.mockResolvedValue({ success: true, data: availability });
    const service = new VersionControlService();
    await service.initialize(createContext(), async () => undefined);
    return service;
}

function status(overrides: Partial<VcsStatus> = {}): VcsStatus {
    return {
        branch: "main",
        head: "aa",
        revisionNumber: 3,
        clean: false,
        files: [],
        counts: { added: 0, modified: 0, deleted: 0, moved: 0, copied: 0 },
        sync: {
            remoteAvailable: false,
            remoteAuthorized: false,
            remoteBranchExists: false,
            localAhead: false,
            remoteAhead: false,
        },
        ...overrides,
    };
}

beforeEach(() => {
    for (const fn of Object.values(vcs)) fn.mockReset();
});

describe("VersionControlService availability", () => {
    it("probes once and reuses the answer, including for concurrent callers", async () => {
        const service = await createService();

        const [first, second] = await Promise.all([service.getAvailability(), service.getAvailability()]);
        const third = await service.getAvailability();

        expect(first).toEqual({ available: true });
        expect(second).toEqual({ available: true });
        expect(third).toEqual({ available: true });
        expect(vcs.getAvailability).toHaveBeenCalledTimes(1);
    });

    it("reads a failed probe as an unavailable installation, not as an exception", async () => {
        vcs.getAvailability.mockResolvedValue({ success: false, error: "host exploded" });
        const service = new VersionControlService();
        await service.initialize(createContext(), async () => undefined);

        await expect(service.getAvailability()).resolves.toEqual({
            available: false,
            reason: "backend-load-failed",
            detail: "host exploded",
        });
    });

    it("answers a rejected channel without caching it, so the feature can come back", async () => {
        vcs.getAvailability.mockRejectedValueOnce(new Error("no handler registered"));
        const service = new VersionControlService();
        await service.initialize(createContext(), async () => undefined);

        // Not a throw: every read on this service waits on this answer and promises to
        // degrade rather than throw, so a rejection here would break all of them at once.
        await expect(service.getAvailability()).resolves.toEqual({
            available: false,
            reason: "backend-load-failed",
            detail: "no handler registered",
        });

        vcs.getAvailability.mockResolvedValue({ success: true, data: { available: true } });
        await expect(service.getAvailability()).resolves.toEqual({ available: true });
        expect(vcs.getAvailability).toHaveBeenCalledTimes(2);
    });

    it("re-probes for a new workspace context after teardown", async () => {
        const service = await createService();
        await service.getAvailability();
        await service.teardown(service.getContext());

        await service.initialize(createContext(), async () => undefined);
        await service.getAvailability();

        expect(vcs.getAvailability).toHaveBeenCalledTimes(2);
    });
});

describe("VersionControlService on a host without a backend", () => {
    const unavailable: VcsAvailability = { available: false, reason: "unsupported-platform" };

    it("answers empty without reaching the host at all", async () => {
        const service = await createService(unavailable);

        await expect(service.isRepository()).resolves.toBe(false);
        await expect(service.getInfo()).resolves.toBeNull();
        await expect(service.getHistory()).resolves.toEqual([]);
        await expect(service.getChangedPaths("a", "b")).resolves.toEqual([]);
        await expect(service.refreshStatus()).resolves.toBeNull();
        expect(service.getStatus()).toBeNull();
        expect(service.getChangedFiles()).toEqual([]);

        expect(vcs.isRepository).not.toHaveBeenCalled();
        expect(vcs.getInfo).not.toHaveBeenCalled();
        expect(vcs.getHistory).not.toHaveBeenCalled();
        expect(vcs.getChangedPaths).not.toHaveBeenCalled();
        // The one that matters most: no scan, so no staged state written on a host
        // that cannot do anything with it anyway.
        expect(vcs.getStatus).not.toHaveBeenCalled();
    });

    it("throws when asked to create a repository it cannot create", async () => {
        const service = await createService(unavailable);

        // Enabling version control is the author's explicit act. Resolving quietly
        // would leave them believing their work is being recorded.
        await expect(service.initRepository()).rejects.toThrow("unsupported-platform");
        expect(vcs.initRepository).not.toHaveBeenCalled();
    });
});

describe("VersionControlService status", () => {
    it("scans only when asked, and serves the snapshot without scanning", async () => {
        const service = await createService();
        vcs.getStatus.mockImplementation(() => ok(status()));

        // Nothing has scanned yet - which is not the same as "clean".
        expect(service.getStatus()).toBeNull();
        expect(vcs.getStatus).not.toHaveBeenCalled();

        const scanned = await service.refreshStatus();
        expect(scanned).toEqual(status());
        expect(vcs.getStatus).toHaveBeenCalledTimes(1);

        // Reading it back any number of times must not scan again: every scan can
        // record a newly discovered directory into staged state.
        expect(service.getStatus()).toEqual(status());
        expect(service.getStatus()).toEqual(status());
        expect(vcs.getStatus).toHaveBeenCalledTimes(1);

        await service.refreshStatus();
        expect(vcs.getStatus).toHaveBeenCalledTimes(2);
    });

    it("notifies subscribers on every refresh", async () => {
        const service = await createService();
        const seen: (VcsStatus | null)[] = [];
        const unsubscribe = service.onStatusChanged((next) => seen.push(next));

        vcs.getStatus.mockImplementation(() => ok(status({ clean: true })));
        await service.refreshStatus();
        vcs.getStatus.mockImplementation(() => Promise.resolve({ success: false, error: "not a repository" }));
        await service.refreshStatus();

        expect(seen).toEqual([status({ clean: true }), null]);
        unsubscribe();
        await service.refreshStatus();
        expect(seen).toHaveLength(2);
    });

    it("filters directories out of the file view while leaving the backend's counts alone", async () => {
        const service = await createService();
        const backend = status({
            files: [
                {
                    path: "editor/story",
                    kind: "added",
                    directory: true,
                    size: 0,
                    staged: false,
                    dirty: true,
                    conflicted: false,
                    conflictUnresolved: false,
                },
                {
                    path: "editor/story/index.json",
                    kind: "modified",
                    directory: false,
                    size: 120,
                    staged: false,
                    dirty: true,
                    conflicted: false,
                    conflictUnresolved: false,
                },
            ],
            // Two entries, and the summary counts both - the directory is a change in
            // its own right. Re-deriving these from the filtered list would give the
            // author a second opinion that disagrees with the repository.
            counts: { added: 1, modified: 1, deleted: 0, moved: 0, copied: 0 },
        });
        vcs.getStatus.mockImplementation(() => ok(backend));

        await service.refreshStatus();

        expect(service.getStatus()?.files).toHaveLength(2);
        expect(service.getChangedFiles().map((file) => file.path)).toEqual(["editor/story/index.json"]);
        expect(service.getStatus()?.counts).toEqual({ added: 1, modified: 1, deleted: 0, moved: 0, copied: 0 });
    });

    it("keeps status paths repository-relative, the shape the read side takes", async () => {
        const service = await createService();
        vcs.getStatus.mockImplementation(() => ok(status({
            files: [{
                path: "assets/content/ab/cd/sprite.png",
                kind: "modified",
                directory: false,
                size: 10,
                staged: false,
                dirty: true,
                conflicted: false,
                conflictUnresolved: false,
            }],
        })));
        vcs.readBlob.mockImplementation(() => ok({ contentBase64: "AAEC" }));

        await service.refreshStatus();
        const [change] = service.getChangedFiles();
        await service.readBlob("rev", change.path);

        // Handed straight to a read verb. A write verb would need it made absolute
        // first, and nothing here does that conversion for a caller.
        expect(vcs.readBlob).toHaveBeenCalledWith(PROJECT, "rev", "assets/content/ab/cd/sprite.png");
    });
});

describe("VersionControlService history and blobs", () => {
    it("caches history per limit and drops a failed read", async () => {
        const service = await createService();
        vcs.getHistory.mockImplementation(() => ok({ entries: [{ revision: "aa", number: 1, parents: [] }] }));

        await service.getHistory(10);
        await service.getHistory(10);
        expect(vcs.getHistory).toHaveBeenCalledTimes(1);

        // A different page is a different question.
        await service.getHistory(0);
        expect(vcs.getHistory).toHaveBeenCalledTimes(2);

        service.invalidateHistory();
        await service.getHistory(10);
        expect(vcs.getHistory).toHaveBeenCalledTimes(3);
    });

    it("decodes blob bytes and refuses to fake an empty file", async () => {
        const service = await createService();
        vcs.readBlob.mockImplementation(() => ok({ contentBase64: "AAECf/8=" }));

        await expect(service.readBlob("rev", "a.png")).resolves.toEqual(new Uint8Array([0, 1, 2, 127, 255]));

        vcs.readBlob.mockImplementation(() => Promise.resolve({ success: false, error: "no such revision" }));
        await expect(service.readBlob("rev", "a.png")).rejects.toThrow("no such revision");
    });
});

describe("VersionControlService init", () => {
    it("returns the new repository and drops everything cached from before it existed", async () => {
        const service = await createService();
        vcs.getStatus.mockImplementation(() => ok(status()));
        vcs.getHistory.mockImplementation(() => ok({ entries: [] }));
        vcs.initRepository.mockImplementation(() => ok({
            root: PROJECT,
            repositoryId: "ff",
            head: "aa",
            revisionCount: 1,
        }));

        await service.refreshStatus();
        await service.getHistory(10);

        const info = await service.initRepository({ message: "Enable version control" });

        expect(vcs.initRepository).toHaveBeenCalledWith(PROJECT, { message: "Enable version control" });
        expect(info.repositoryId).toBe("ff");
        expect(service.getStatus()).toBeNull();
        await service.getHistory(10);
        expect(vcs.getHistory).toHaveBeenCalledTimes(2);
    });

    it("reports a refused init to the caller", async () => {
        const service = await createService();
        vcs.initRepository.mockImplementation(() =>
            Promise.resolve({ success: false, error: `${PROJECT} is already under version control` }));

        await expect(service.initRepository()).rejects.toThrow("already under version control");
    });
});
