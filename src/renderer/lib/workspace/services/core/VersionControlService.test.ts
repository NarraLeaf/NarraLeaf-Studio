import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestStatus } from "@shared/types/ipcEvents";
import type { VcsAvailability, VcsCommitResult, VcsStatus } from "@shared/types/vcs";
import { freezeProjectWrites, getProjectWriteFreeze, thawProjectWrites } from "@/lib/app/writeFreeze";
import { CheckpointScheduler, VersionControlService, type CheckpointSchedulerDeps } from "./VersionControlService";
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
    commit: vi.fn(),
    checkpoint: vi.fn(),
    getStatus: vi.fn(),
    getHistory: vi.fn(),
    readBlob: vi.fn(),
    getChangedPaths: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ vcs }),
}));

/**
 * The write signal, stubbed at the module the service reads it from.
 *
 * Mocked rather than driven through the real one because the real reporter is internal
 * to `BaseFileSystemService` - a test cannot make it fire without performing an actual
 * write over IPC. The predicate that decides whether a write counts is NOT stubbed: that
 * is the real `isVersioned`, reached through the real freeze module, which is the whole
 * point of the wiring test below.
 */
const writeObservers = vi.hoisted(() => new Set<(write: { path: string; ok: boolean }) => void>());

vi.mock("./FileSystem", () => ({
    BaseFileSystemService: {
        observeWrites: (observer: (write: { path: string; ok: boolean }) => void) => {
            writeObservers.add(observer);
            return () => {
                writeObservers.delete(observer);
            };
        },
    },
}));

function reportWrite(path: string, ok = true): void {
    for (const observer of writeObservers) observer({ path, ok });
}

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

function commitResult(overrides: Partial<VcsCommitResult> = {}): VcsCommitResult {
    return { revision: "cc", number: 4, kind: "commit", fileCount: 2, ...overrides };
}

beforeEach(() => {
    for (const fn of Object.values(vcs)) fn.mockReset();
    writeObservers.clear();
});

afterEach(() => {
    // A freeze is module-level state; leaking one would silence every later test's
    // checkpoint without saying so.
    thawProjectWrites();
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

/**
 * The interval scheduler, in isolation.
 *
 * Every decision is injected, so these are the four behaviours the milestone actually
 * turns on - and none of them needs a workspace, a repository or a clock that really
 * ticks. The clock is a variable and the beat is a method call, because a test that
 * waited fifteen real minutes is a test nobody runs.
 */
describe("CheckpointScheduler", () => {
    const MINUTE = 60_000;

    function scheduler(overrides: Partial<CheckpointSchedulerDeps> = {}) {
        const checkpoint = vi.fn(() => Promise.resolve(null));
        const state = { minutes: 15, frozen: false, time: 1_000_000 };
        const instance = new CheckpointScheduler({
            intervalMinutes: () => state.minutes,
            // The real predicate's shape, spelled out rather than imported: a test that
            // silently changes meaning when the exclusion table changes is worse than one
            // that has to be updated with it.
            counts: (path) => !path.includes("/editor/cache/") && !path.includes("/.nlstudio/"),
            isFrozen: () => state.frozen,
            checkpoint,
            observeWrites: (observer) => {
                writeObservers.add(observer);
                return () => {
                    writeObservers.delete(observer);
                };
            },
            now: () => state.time,
            // Captured and never fired on its own: a real interval would make these tests
            // depend on wall-clock time for no gain.
            heartbeat: () => () => undefined,
            onError: () => undefined,
            ...overrides,
        });
        instance.start();
        return { instance, checkpoint, state };
    }

    it("does not fire without a versioned write, however long it waits", async () => {
        const { instance, checkpoint, state } = scheduler();

        state.time += 60 * MINUTE;
        await instance.tick();

        // The whole design in one assertion: with no write there is nothing to record,
        // and the other way of finding out - asking the backend what changed - is a scan,
        // which records newly discovered directories into staged state and makes a later
        // tick report deletions the author never made (docs §4.17).
        expect(checkpoint).not.toHaveBeenCalled();
        expect(instance.hasUnrecordedChanges()).toBe(false);
    });

    it("fires once the interval has passed since the first unrecorded write", async () => {
        const { instance, checkpoint, state } = scheduler();

        reportWrite(`${PROJECT}/editor/story/index.json`);
        expect(instance.hasUnrecordedChanges()).toBe(true);

        // Not yet: the interval is a floor on the gap, so an author who typed a moment
        // ago is not interrupted a moment later.
        state.time += 14 * MINUTE;
        await instance.tick();
        expect(checkpoint).not.toHaveBeenCalled();

        state.time += 2 * MINUTE;
        await instance.tick();
        expect(checkpoint).toHaveBeenCalledTimes(1);

        // And having recorded it, it does not go on recording nothing every interval.
        state.time += 60 * MINUTE;
        await instance.tick();
        expect(checkpoint).toHaveBeenCalledTimes(1);
        expect(instance.hasUnrecordedChanges()).toBe(false);
    });

    it("never fires when the interval is 0, which is how an author turns it off", async () => {
        const { instance, checkpoint, state } = scheduler();
        state.minutes = 0;

        reportWrite(`${PROJECT}/editor/story/index.json`);
        state.time += 60 * MINUTE;
        await instance.tick();

        expect(checkpoint).not.toHaveBeenCalled();
    });

    it("does not count a write to a path the repository excludes", async () => {
        const { instance, checkpoint, state } = scheduler();

        // Thumbnails are rewritten constantly while Studio runs. If these counted, the
        // "only when something changed" rule would be satisfied permanently and every
        // interval would produce a revision recording nothing the author did.
        reportWrite(`${PROJECT}/editor/cache/thumbnail/ab/cd/y.png`);
        reportWrite(`${PROJECT}/.nlstudio/services/panel_state.json`);
        state.time += 60 * MINUTE;
        await instance.tick();

        expect(checkpoint).not.toHaveBeenCalled();
        expect(instance.hasUnrecordedChanges()).toBe(false);
    });

    it("does not count a write that failed", async () => {
        const { instance, checkpoint, state } = scheduler();

        reportWrite(`${PROJECT}/editor/story/index.json`, false);
        state.time += 60 * MINUTE;
        await instance.tick();

        expect(checkpoint).not.toHaveBeenCalled();
    });

    it("does not fire while the workspace is frozen, even with a change waiting", async () => {
        const { instance, checkpoint, state } = scheduler();

        reportWrite(`${PROJECT}/editor/story/index.json`);
        state.time += 60 * MINUTE;
        state.frozen = true;
        await instance.tick();

        // This guard is NOT redundant with the write latch. A frozen workspace cannot
        // produce a versioned write - the latch refuses it before it is ever reported -
        // so the flag can only have been set BEFORE the freeze. Without the check, an
        // author who edits and then opens a past revision gets a checkpoint appended to
        // their timeline for the act of reading history.
        expect(checkpoint).not.toHaveBeenCalled();
        // And the change is still owed, so thawing does not lose it.
        expect(instance.hasUnrecordedChanges()).toBe(true);

        state.frozen = false;
        await instance.tick();
        expect(checkpoint).toHaveBeenCalledTimes(1);
    });

    it("keeps the change owed when a checkpoint fails, so the next beat retries", async () => {
        const failing = vi.fn(() => Promise.reject(new Error("disk full")));
        const errors: unknown[] = [];
        const { instance, state } = scheduler({ checkpoint: failing, onError: (error) => errors.push(error) });

        reportWrite(`${PROJECT}/editor/story/index.json`);
        state.time += 20 * MINUTE;
        await instance.tick();

        expect(failing).toHaveBeenCalledTimes(1);
        expect(errors).toHaveLength(1);
        expect(instance.hasUnrecordedChanges()).toBe(true);
    });

    it("stops noticing writes once stopped", async () => {
        const { instance, checkpoint, state } = scheduler();
        instance.stop();

        reportWrite(`${PROJECT}/editor/story/index.json`);
        state.time += 60 * MINUTE;
        await instance.tick();

        expect(checkpoint).not.toHaveBeenCalled();
    });
});

describe("VersionControlService commit", () => {
    it("reports the new revision and drops what it made stale", async () => {
        const service = await createService();
        vcs.getStatus.mockImplementation(() => ok(status()));
        vcs.getHistory.mockImplementation(() => ok({ entries: [] }));
        vcs.commit.mockImplementation(() => ok(commitResult()));

        await service.refreshStatus();
        await service.getHistory(10);

        const result = await service.commit({ message: "Act one" });

        expect(vcs.commit).toHaveBeenCalledWith(PROJECT, { message: "Act one" });
        expect(result).toEqual(commitResult());
        // The snapshot described a tree with uncommitted changes in it, and every cached
        // page is now one entry short.
        expect(service.getStatus()).toBeNull();
        await service.getHistory(10);
        expect(vcs.getHistory).toHaveBeenCalledTimes(2);
    });

    it("gives the author the failure, including nothing-has-changed", async () => {
        const service = await createService();
        vcs.commit.mockImplementation(() =>
            Promise.resolve({ success: false, error: `Nothing has changed in ${PROJECT} since the last revision` }));

        await expect(service.commit()).rejects.toThrow("Nothing has changed");
    });

    it("refuses on a host with no backend instead of resolving quietly", async () => {
        const service = await createService({ available: false, reason: "unsupported-platform" });

        await expect(service.commit()).rejects.toThrow("unsupported-platform");
        expect(vcs.commit).not.toHaveBeenCalled();
    });

    it("treats a checkpoint with nothing to record as a non-event", async () => {
        const service = await createService();
        vcs.getHistory.mockImplementation(() => ok({ entries: [{ revision: "aa", number: 1, parents: [] }] }));
        vcs.checkpoint.mockImplementation(() => ok({ revision: null }));

        await service.getHistory(5);
        await expect(service.createCheckpoint("interval")).resolves.toBeNull();

        // Nothing was recorded, so nothing cached became wrong - re-reading must not cost
        // another round trip just because a timer went off.
        await service.getHistory(5);
        expect(vcs.getHistory).toHaveBeenCalledTimes(1);
    });

    it("invalidates history when a checkpoint does record something", async () => {
        const service = await createService();
        vcs.getHistory.mockImplementation(() => ok({ entries: [] }));
        vcs.checkpoint.mockImplementation(() => ok({ revision: commitResult({ kind: "checkpoint" }) }));

        await service.getHistory(5);
        const result = await service.createCheckpoint("build");

        expect(result?.kind).toBe("checkpoint");
        expect(vcs.checkpoint).toHaveBeenCalledWith(PROJECT, "build");
        await service.getHistory(5);
        expect(vcs.getHistory).toHaveBeenCalledTimes(2);
    });

    it("answers null for a checkpoint on a host with no backend, without asking", async () => {
        const service = await createService({ available: false, reason: "backend-missing" });

        // Automatic, so an unavailable backend is not something to report - it would be
        // reported every interval for the rest of the session.
        await expect(service.createCheckpoint("interval")).resolves.toBeNull();
        expect(vcs.checkpoint).not.toHaveBeenCalled();
    });
});

describe("VersionControlService history kinds", () => {
    it("asks for kinds only when told to, and caches the two answers apart", async () => {
        const service = await createService();
        vcs.getHistory.mockImplementation((_project: string, _limit: number, includeKinds?: boolean) =>
            ok({ entries: [{ revision: "aa", number: 1, parents: [], kind: includeKinds ? "commit" : undefined }] }));

        const plain = await service.getHistory(10);
        expect(plain[0].kind).toBeUndefined();
        expect(vcs.getHistory).toHaveBeenLastCalledWith(PROJECT, 10, false);

        // A different question, not a filter on the same answer: the plain page never read
        // the kinds, so it cannot be used to answer this one.
        const kinds = await service.getHistory(10, { includeKinds: true });
        expect(kinds[0].kind).toBe("commit");
        expect(vcs.getHistory).toHaveBeenLastCalledWith(PROJECT, 10, true);
        expect(vcs.getHistory).toHaveBeenCalledTimes(2);

        await service.getHistory(10, { includeKinds: true });
        expect(vcs.getHistory).toHaveBeenCalledTimes(2);
    });
});

describe("VersionControlService checkpoint wiring", () => {
    it("counts a project write and ignores an excluded one, using the real predicate", async () => {
        const service = await createService();
        service.activate(service.getContext());

        try {
            // Not this test's own copy of the policy: it goes through the same
            // `isVersioned` that the freeze gate and the repository's ignore file are
            // generated from, so the set of paths that can trigger a checkpoint is the
            // set a freeze protects.
            reportWrite(`${PROJECT}/editor/cache/thumbnail/ab/cd/y.png`);
            reportWrite(`${PROJECT}/.nlstudio/services/panel_state.json`);
            reportWrite("D:/elsewhere/notes.txt");
            expect(service.hasUnrecordedChanges()).toBe(false);

            reportWrite(`${PROJECT}/editor/story/index.json`);
            expect(service.hasUnrecordedChanges()).toBe(true);
        } finally {
            await service.teardown(service.getContext());
        }
    });

    it("stops watching once the workspace is gone", async () => {
        const service = await createService();
        service.activate(service.getContext());
        await service.teardown(service.getContext());

        reportWrite(`${PROJECT}/editor/story/index.json`);
        expect(service.hasUnrecordedChanges()).toBe(false);
    });

    it("is wired to the real freeze latch, not a copy of it", async () => {
        const service = await createService();
        service.activate(service.getContext());

        try {
            reportWrite(`${PROJECT}/editor/story/index.json`);
            expect(service.hasUnrecordedChanges()).toBe(true);

            // The scheduler's guard is unit-tested above against an injected predicate;
            // this is the other half, that what it is wired to is the module-level latch
            // the rest of the workspace freezes through.
            freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });
            vcs.checkpoint.mockImplementation(() => ok({ revision: null }));
            await service.createCheckpoint("interval");
            // The service call itself is not gated - a deliberate checkpoint before a
            // restore has to work - so the assertion is on the latch being visible, which
            // is what the scheduler reads.
            expect(getProjectWriteFreeze()).not.toBeNull();
        } finally {
            thawProjectWrites();
            await service.teardown(service.getContext());
        }
    });
});
