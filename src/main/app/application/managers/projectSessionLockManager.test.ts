import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectSessionHolder } from "@shared/types/projectSession";
import {
    PROJECT_SESSION_HEARTBEAT_MS,
    PROJECT_SESSION_LOCK_RELATIVE_PATH,
    PROJECT_SESSION_LOCK_STALE_MS,
    parseProjectSessionLockRecord,
    serializeProjectSessionLockRecord,
    type ProjectSessionLockRecord,
} from "../projectSessionLock";
import { ProjectSessionLockManager } from "./projectSessionLockManager";

const roots: string[] = [];

async function scratchProject(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nl-session-lock-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "Demo.nlproj"), "config", "utf-8");
    return root;
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

function lockPathOf(projectPath: string): string {
    return path.join(projectPath, PROJECT_SESSION_LOCK_RELATIVE_PATH);
}

async function readLock(projectPath: string): Promise<ProjectSessionLockRecord | null> {
    try {
        return parseProjectSessionLockRecord(await fs.readFile(lockPathOf(projectPath), "utf-8"));
    } catch {
        return null;
    }
}

async function writeLock(projectPath: string, record: ProjectSessionLockRecord): Promise<void> {
    await fs.mkdir(path.dirname(lockPathOf(projectPath)), { recursive: true });
    await fs.writeFile(lockPathOf(projectPath), serializeProjectSessionLockRecord(record), "utf-8");
}

/** A clock the test moves by hand, so a two-minute staleness rule takes no time to check. */
function clock(startMs: number) {
    let current = startMs;
    return {
        now: () => current,
        advance: (ms: number) => {
            current += ms;
        },
    };
}

interface HarnessOptions {
    now?: () => number;
    /** Which process ids this machine is pretending to run. */
    alive?: Set<number>;
    pid?: number;
    hostname?: string;
    userDataDir?: string;
    /** Stands in for the wait before a silent live claim is taken; resolves at once by default. */
    sleep?: (ms: number) => Promise<void>;
    onTakenOver?: (projectPath: string, holder: ProjectSessionHolder) => void;
}

function manager(options: HarnessOptions = {}) {
    const alive = options.alive ?? new Set([4242]);
    return new ProjectSessionLockManager({
        userDataDir: options.userDataDir ?? "C:/profiles/studio",
        logger: { info: vi.fn(), warn: vi.fn() },
        now: options.now ?? (() => Date.parse("2026-09-01T10:00:00.000Z")),
        isProcessAlive: pid => alive.has(pid),
        pid: options.pid ?? 4242,
        hostname: options.hostname ?? "studio-one",
        // Nothing is racing inside a single test, so the confirmation delay would only be a delay.
        takeoverSettleMs: 0,
        sleep: options.sleep ?? (async () => undefined),
        onTakenOver: options.onTakenOver,
    });
}

/** A record left by somebody else, heartbeating as of `at`. */
function otherSession(at: number, overrides: Partial<ProjectSessionLockRecord> = {}): ProjectSessionLockRecord {
    return {
        pid: 9001,
        hostname: "studio-two",
        installation: "0f0f0f0f0f0f0f0f",
        startedAt: new Date(at).toISOString(),
        heartbeat: new Date(at).toISOString(),
        ...overrides,
    };
}

describe("ProjectSessionLockManager", () => {
    it("takes an unheld project and records who has it", async () => {
        const project = await scratchProject();
        const locks = manager();

        await expect(locks.acquire(project)).resolves.toEqual({ ok: true });
        expect(locks.holds(project)).toBe(true);

        const record = await readLock(project);
        expect(record).toMatchObject({ pid: 4242, hostname: "studio-one" });
        // The digest identifies the profile without carrying the path it was made from.
        expect(record?.installation).not.toContain("profiles");
        locks.dispose();
    });

    it("refuses a project another session is still heartbeating", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        await writeLock(project, otherSession(time.now() - 20_000));

        const locks = manager({ now: time.now });
        const outcome = await locks.acquire(project);

        expect(outcome).toEqual({
            ok: false,
            holder: {
                hostname: "studio-two",
                startedAt: new Date(time.now() - 20_000).toISOString(),
                sameHost: false,
            },
        });
        expect(locks.holds(project)).toBe(false);
        // The other session's claim is left exactly as it was.
        expect((await readLock(project))?.pid).toBe(9001);
        locks.dispose();
    });

    it("says nothing about the holder beyond the machine and the time", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        await writeLock(project, otherSession(time.now()));

        const outcome = await manager({ now: time.now }).acquire(project);
        if (outcome.ok) throw new Error("expected a refusal");
        // Nothing an author cannot act on, and no identifier of any kind.
        expect(Object.keys(outcome.holder).sort()).toEqual(["hostname", "sameHost", "startedAt"]);
    });

    it("takes over a claim by a process that is no longer running on this machine", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        // Same host, fresh heartbeat - only the missing process says the session is gone.
        await writeLock(project, otherSession(time.now(), { hostname: "studio-one", pid: 7000 }));

        const locks = manager({ now: time.now, alive: new Set([4242]) });
        await expect(locks.acquire(project)).resolves.toEqual({ ok: true });
        expect((await readLock(project))?.pid).toBe(4242);
        locks.dispose();
    });

    it("keeps a claim by a process that is still running on this machine", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        await writeLock(project, otherSession(time.now(), { hostname: "studio-one", pid: 7000 }));

        const locks = manager({ now: time.now, alive: new Set([4242, 7000]) });
        const outcome = await locks.acquire(project);

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
            // The same machine, which is what the screen says instead of a hostname the reader owns.
            expect(outcome.holder.sameHost).toBe(true);
        }
        locks.dispose();
    });

    it("takes over a claim from another machine once its heartbeat has stopped", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        await writeLock(project, otherSession(time.now()));

        const locks = manager({ now: time.now });
        // Just inside the window: still somebody's project.
        time.advance(PROJECT_SESSION_LOCK_STALE_MS - 1_000);
        expect((await locks.acquire(project)).ok).toBe(false);

        // Past it: nothing has said it is there for two minutes.
        time.advance(2_000);
        await expect(locks.acquire(project)).resolves.toEqual({ ok: true });
        expect((await readLock(project))?.hostname).toBe("studio-one");
        locks.dispose();
    });

    it("treats a claim it cannot read as no claim at all", async () => {
        const project = await scratchProject();
        await fs.mkdir(path.dirname(lockPathOf(project)), { recursive: true });
        await fs.writeFile(lockPathOf(project), "{ half written", "utf-8");

        const locks = manager();
        await expect(locks.acquire(project)).resolves.toEqual({ ok: true });
        locks.dispose();
    });

    it("answers a project it already holds without touching the disk", async () => {
        const project = await scratchProject();
        const locks = manager();
        await locks.acquire(project);

        // Somebody else's record appearing underneath is not re-read: this process is holding the
        // project, and `openProject` and the window's own startup both ask.
        await writeLock(project, otherSession(Date.parse("2026-09-01T10:00:00.000Z")));
        await expect(locks.acquire(project)).resolves.toEqual({ ok: true });
        locks.dispose();
    });

    it("moves the heartbeat on while the project is held", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        const locks = manager({ now: time.now });
        await locks.acquire(project);

        const started = await readLock(project);
        time.advance(30_000);
        await locks.beat();

        const beaten = await readLock(project);
        expect(beaten?.startedAt).toBe(started?.startedAt);
        expect(Date.parse(beaten?.heartbeat ?? "")).toBe(time.now());
        locks.dispose();
    });

    it("stops holding a project whose claim was taken over while it was away", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        const locks = manager({ now: time.now });
        await locks.acquire(project);

        await writeLock(project, otherSession(time.now()));
        await locks.beat();

        expect(locks.holds(project)).toBe(false);
        // And the other session's claim is left alone rather than stamped over.
        expect((await readLock(project))?.pid).toBe(9001);
        locks.dispose();
    });

    it("removes the claim on release, so the next Studio opens the project outright", async () => {
        const project = await scratchProject();
        const first = manager();
        await first.acquire(project);
        await first.release(project);

        expect(await readLock(project)).toBeNull();
        expect(first.holds(project)).toBe(false);

        const second = manager({ pid: 5555, userDataDir: "C:/profiles/other" });
        await expect(second.acquire(project)).resolves.toEqual({ ok: true });
        second.dispose();
    });

    it("leaves a claim that is no longer its own alone on release", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        const locks = manager({ now: time.now });
        await locks.acquire(project);

        await writeLock(project, otherSession(time.now()));
        await locks.release(project);

        // Deleting it here would have handed the project to a third Studio while a second edits it.
        expect((await readLock(project))?.pid).toBe(9001);
        locks.dispose();
    });

    it("releases every project it holds at once", async () => {
        const one = await scratchProject();
        const two = await scratchProject();
        const locks = manager();
        await locks.acquire(one);
        await locks.acquire(two);

        await locks.releaseAll();

        expect(await readLock(one)).toBeNull();
        expect(await readLock(two)).toBeNull();
        locks.dispose();
    });

    it("releases synchronously for an exit that never reaches the event loop", async () => {
        const project = await scratchProject();
        const locks = manager();
        await locks.acquire(project);

        locks.releaseAllSync();

        expect(await readLock(project)).toBeNull();
    });

    it("is one claim per project however the path is spelled", async () => {
        const project = await scratchProject();
        const locks = manager();
        await locks.acquire(project);

        // The spelling a script or a CDP session hands in, against the one a native picker returns.
        const alternative = project.replace(/\\/g, "/");
        expect(locks.holds(alternative)).toBe(process.platform === "win32" || alternative === project);
        locks.dispose();
    });

    it("opens a project it cannot write a claim into", async () => {
        // A directory that is not there stands in for anything the lock cannot be written to: a
        // read-only volume, a folder this user may only read. The project still opens.
        const locks = manager();
        const missing = path.join(os.tmpdir(), "nl-session-lock-absent", "\0invalid");
        await expect(locks.acquire(missing)).resolves.toEqual({ ok: true });
        locks.dispose();
    });
});

/**
 * Whether this Studio was turned away from a project - the question the runtimes ask before they
 * start (see `projectSessionGate`).
 *
 * It exists because the window that was turned away stays up on its error screen, named after the
 * project, and a Dev Mode started from it came up black: every asset is resolved through the
 * project's workspace, and that workspace never started.
 */
describe("ProjectSessionLockManager.heldElsewhere", () => {
    it("remembers who has a project it was refused", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        await writeLock(project, otherSession(time.now()));

        const locks = manager({ now: time.now });
        await locks.acquire(project);

        expect(locks.heldElsewhere(project)).toEqual({
            hostname: "studio-two",
            startedAt: new Date(time.now()).toISOString(),
            sameHost: false,
        });
        locks.dispose();
    });

    it("says the other Studio is on this computer when it is", async () => {
        const project = await scratchProject();
        await writeLock(project, otherSession(Date.parse("2026-09-01T10:00:00.000Z"), { hostname: "studio-one", pid: 7000 }));

        const locks = manager({ alive: new Set([4242, 7000]) });
        await locks.acquire(project);

        expect(locks.heldElsewhere(project)?.sameHost).toBe(true);
        locks.dispose();
    });

    it("answers for the project however its path is spelled", async () => {
        const project = await scratchProject();
        await writeLock(project, otherSession(Date.parse("2026-09-01T10:00:00.000Z")));

        const locks = manager();
        await locks.acquire(project);

        // The runtimes ask with the window's own spelling, which need not be the one opened with.
        const alternative = project.replace(/\\/g, "/");
        if (process.platform === "win32" || alternative === project) {
            expect(locks.heldElsewhere(alternative)).not.toBeNull();
        }
        locks.dispose();
    });

    it("forgets the refusal when a later claim gets in", async () => {
        // Retry on the error screen, after the other Studio has closed the project.
        const project = await scratchProject();
        await writeLock(project, otherSession(Date.parse("2026-09-01T10:00:00.000Z")));

        const locks = manager();
        await locks.acquire(project);
        expect(locks.heldElsewhere(project)).not.toBeNull();

        await fs.rm(lockPathOf(project));
        await expect(locks.acquire(project)).resolves.toEqual({ ok: true });

        expect(locks.heldElsewhere(project)).toBeNull();
        expect(locks.holds(project)).toBe(true);
        locks.dispose();
    });

    it("keeps refusing after the other Studio has gone, until this one claims again", async () => {
        // The window that was turned away is still on its error screen: its workspace has not
        // started, so nothing that needs one may start beside it just because the lock is free now.
        const project = await scratchProject();
        await writeLock(project, otherSession(Date.parse("2026-09-01T10:00:00.000Z")));

        const locks = manager();
        await locks.acquire(project);
        await fs.rm(lockPathOf(project));

        expect(locks.heldElsewhere(project)).not.toBeNull();
        locks.dispose();
    });

    it("forgets the refusal when the project's last window closes", async () => {
        const project = await scratchProject();
        await writeLock(project, otherSession(Date.parse("2026-09-01T10:00:00.000Z")));

        const locks = manager();
        await locks.acquire(project);
        await locks.release(project);

        expect(locks.heldElsewhere(project)).toBeNull();
        // And the other Studio's claim is still exactly where it was.
        expect((await readLock(project))?.pid).toBe(9001);
        locks.dispose();
    });

    it("is not held elsewhere when this Studio holds it", async () => {
        const project = await scratchProject();
        const locks = manager();
        await locks.acquire(project);

        expect(locks.heldElsewhere(project)).toBeNull();
        locks.dispose();
    });

    it("is not held elsewhere when the claim was taken over from a Studio that is gone", async () => {
        const project = await scratchProject();
        // Same machine, fresh heartbeat, but the process behind it has died: a crash, a kill.
        await writeLock(project, otherSession(Date.parse("2026-09-01T10:00:00.000Z"), { hostname: "studio-one", pid: 7000 }));

        const locks = manager({ alive: new Set([4242]) });
        await expect(locks.acquire(project)).resolves.toEqual({ ok: true });

        expect(locks.heldElsewhere(project)).toBeNull();
        locks.dispose();
    });

    it("does not refuse a project it opened without a claim", async () => {
        // A read-only volume opens with nobody holding the project, and must still run.
        const locks = manager();
        const missing = path.join(os.tmpdir(), "nl-session-lock-absent", "\0invalid");
        await locks.acquire(missing);

        expect(locks.heldElsewhere(missing)).toBeNull();
        locks.dispose();
    });

    it("has nothing to say about a project it was never asked for", () => {
        expect(manager().heldElsewhere(path.join(os.tmpdir(), "never-opened"))).toBeNull();
    });
});

/**
 * A Studio that held a project and lost it: another one judged it gone - its heartbeat stood still
 * for the whole staleness window, as a suspended process's or a debugger-stopped one's does - and
 * took the project over. The holder finds out on its own next heartbeat, and until this was
 * reported anywhere it went on editing and saving beside the Studio that had taken it.
 */
describe("ProjectSessionLockManager when a held project is taken over", () => {
    it("reports the takeover its heartbeat finds, with the other Studio as the lock screen names it", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        const onTakenOver = vi.fn();
        const locks = manager({ now: time.now, onTakenOver });
        await locks.acquire(project);

        await writeLock(project, otherSession(time.now()));
        await locks.beat();

        expect(onTakenOver).toHaveBeenCalledTimes(1);
        const [reportedPath, holder] = onTakenOver.mock.calls[0];
        expect(path.resolve(reportedPath)).toBe(path.resolve(project));
        expect(holder).toEqual({
            hostname: "studio-two",
            startedAt: new Date(time.now()).toISOString(),
            sameHost: false,
        });
        locks.dispose();
    });

    it("refuses the project from then on, as if it had been refused at the door", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        const locks = manager({ now: time.now });
        await locks.acquire(project);

        // The taker runs on this machine too, so the screen says "this computer" rather than a name.
        await writeLock(project, otherSession(time.now(), { hostname: "studio-one", pid: 7000 }));
        await locks.beat();

        // What Dev Mode, the preview, test runs and builds ask before they start.
        expect(locks.heldElsewhere(project)).toMatchObject({ sameHost: true });
        expect(locks.holds(project)).toBe(false);
        locks.dispose();
    });

    it("reports it once, however many heartbeats find it", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        const onTakenOver = vi.fn();
        const locks = manager({ now: time.now, onTakenOver });
        await locks.acquire(project);

        await writeLock(project, otherSession(time.now()));
        // Two heartbeats in flight at once - a disk slow enough to let a takeover happen at all is
        // slow enough for the next beat to start before this one has read the file.
        await Promise.all([locks.beat(), locks.beat()]);
        await locks.beat();

        expect(onTakenOver).toHaveBeenCalledTimes(1);
        locks.dispose();
    });

    it("leaves the other Studio's claim exactly as it found it, heartbeat and all", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        const locks = manager({ now: time.now });
        await locks.acquire(project);

        const theirs = otherSession(time.now());
        await writeLock(project, theirs);
        time.advance(PROJECT_SESSION_HEARTBEAT_MS);
        await locks.beat();
        await locks.release(project);

        // Neither a heartbeat stamped over it nor a release deleting it: either would hand the
        // project back to a Studio that stopped writing it.
        expect(await readLock(project)).toEqual(theirs);
        locks.dispose();
    });

    it("says nothing when the claim is still its own", async () => {
        const project = await scratchProject();
        const onTakenOver = vi.fn();
        const locks = manager({ onTakenOver });
        await locks.acquire(project);

        await locks.beat();

        expect(onTakenOver).not.toHaveBeenCalled();
        expect(locks.heldElsewhere(project)).toBeNull();
        locks.dispose();
    });

    it("does not let a failing report stop the heartbeat for the projects it still holds", async () => {
        const lost = await scratchProject();
        const kept = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        const locks = manager({
            now: time.now,
            onTakenOver: () => {
                throw new Error("no window to tell");
            },
        });
        await locks.acquire(lost);
        await locks.acquire(kept);

        await writeLock(lost, otherSession(time.now()));
        time.advance(PROJECT_SESSION_HEARTBEAT_MS);
        await locks.beat();

        expect(locks.holds(kept)).toBe(true);
        expect(Date.parse((await readLock(kept))?.heartbeat ?? "")).toBe(time.now());
        locks.dispose();
    });
});

/**
 * A claim whose heartbeat is stale while the process behind it is still running on this machine.
 *
 * That Studio may only be late: a computer that has just woken from sleep resumes every process on
 * it with a heartbeat as old as the sleep, and each is about to write a new one. Taking the project
 * the instant a second Studio asks would hand it over from a Studio that is fine. So the claim looks
 * again one heartbeat later, and takes the project only if nothing has moved.
 */
describe("ProjectSessionLockManager and a silent Studio that is still running here", () => {
    const SILENT_FOR = PROJECT_SESSION_LOCK_STALE_MS + 30_000;

    function silentLiveHolder(now: number): ProjectSessionLockRecord {
        return otherSession(now - SILENT_FOR, { hostname: "studio-one", pid: 7000 });
    }

    it("waits one heartbeat period before taking it", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        await writeLock(project, silentLiveHolder(time.now()));
        const waits: number[] = [];

        const locks = manager({
            now: time.now,
            alive: new Set([4242, 7000]),
            sleep: async ms => {
                waits.push(ms);
                time.advance(ms);
            },
        });

        await expect(locks.acquire(project)).resolves.toEqual({ ok: true });
        expect(waits).toEqual([PROJECT_SESSION_HEARTBEAT_MS]);
        expect((await readLock(project))?.pid).toBe(4242);
        locks.dispose();
    });

    it("stays out when that Studio speaks during the wait", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        const silent = silentLiveHolder(time.now());
        await writeLock(project, silent);

        const locks = manager({
            now: time.now,
            alive: new Set([4242, 7000]),
            sleep: async ms => {
                time.advance(ms);
                // The holder wakes and heartbeats, the way a resumed Studio does straight away.
                await writeLock(project, { ...silent, heartbeat: new Date(time.now()).toISOString() });
            },
        });

        const outcome = await locks.acquire(project);

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
            expect(outcome.holder.sameHost).toBe(true);
        }
        // Its claim is untouched, and nothing of this Studio's was written.
        expect((await readLock(project))?.pid).toBe(7000);
        expect(locks.holds(project)).toBe(false);
        locks.dispose();
    });

    it("walks in when that Studio lets go during the wait", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        await writeLock(project, silentLiveHolder(time.now()));

        const locks = manager({
            now: time.now,
            alive: new Set([4242, 7000]),
            sleep: async ms => {
                time.advance(ms);
                await fs.rm(lockPathOf(project), { force: true });
            },
        });

        await expect(locks.acquire(project)).resolves.toEqual({ ok: true });
        expect((await readLock(project))?.pid).toBe(4242);
        locks.dispose();
    });

    it("does not wait for a Studio whose process is gone", async () => {
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        await writeLock(project, silentLiveHolder(time.now()));
        const sleep = vi.fn(async () => undefined);

        const locks = manager({ now: time.now, alive: new Set([4242]), sleep });

        await expect(locks.acquire(project)).resolves.toEqual({ ok: true });
        expect(sleep).not.toHaveBeenCalled();
        locks.dispose();
    });

    it("does not wait for a silent Studio on another machine", async () => {
        // Nothing here can say whether a remote process runs, so its heartbeat is the whole
        // evidence, as it always was.
        const project = await scratchProject();
        const time = clock(Date.parse("2026-09-01T10:00:00.000Z"));
        await writeLock(project, otherSession(time.now() - SILENT_FOR));
        const sleep = vi.fn(async () => undefined);

        const locks = manager({ now: time.now, sleep });

        await expect(locks.acquire(project)).resolves.toEqual({ ok: true });
        expect(sleep).not.toHaveBeenCalled();
        locks.dispose();
    });
});
