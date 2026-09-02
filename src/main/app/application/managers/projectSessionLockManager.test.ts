import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
