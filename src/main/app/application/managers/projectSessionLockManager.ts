import fsSync from "fs";
import fs from "fs/promises";
import { createHash } from "crypto";
import os from "os";
import path from "path";

import type { ProjectSessionHolder, ProjectSessionLockOutcome } from "@shared/types/projectSession";
import { Fs } from "@shared/utils/fs";
import { normalizeProjectPath } from "@shared/utils/recentProject";

import {
    buildProjectSessionLockRecord,
    decideProjectSessionClaim,
    describeHolder,
    parseProjectSessionLockRecord,
    PROJECT_SESSION_HEARTBEAT_MS,
    PROJECT_SESSION_LOCK_RELATIVE_PATH,
    serializeProjectSessionLockRecord,
    type ProjectSessionIdentity,
    type ProjectSessionLockRecord,
} from "../projectSessionLock";

/** What the manager needs from the world, all of it replaceable so the rules can be tested. */
export interface ProjectSessionLockManagerOptions {
    /**
     * The profile directory, digested into the record so that two Studios on one machine under
     * different profiles are two holders rather than one.
     */
    userDataDir: string;
    logger: Pick<Console, "info" | "warn">;
    now?: () => number;
    /** Whether a process id is running on this machine. */
    isProcessAlive?: (pid: number) => boolean;
    hostname?: string;
    pid?: number;
    heartbeatMs?: number;
    /**
     * How long a takeover waits before confirming that the lock it wrote is still the one on disk.
     *
     * See {@link ProjectSessionLockManager.takeOver}. Zero in tests, where there is no second
     * process to race with and the delay would only be a delay.
     */
    takeoverSettleMs?: number;
}

/** How long a takeover waits before reading back what it wrote. */
const DEFAULT_TAKEOVER_SETTLE_MS = 150;

/** A lock this process is holding. */
interface HeldLock {
    /** The project path as it was resolved, for the log and for the file. */
    projectPath: string;
    lockPath: string;
    record: ProjectSessionLockRecord;
}

/**
 * The locks this process holds on projects, and the heartbeat that keeps them.
 *
 * The rules for whether a claim succeeds are in `projectSessionLock.ts`; this is what talks to the
 * disk, keeps the timer and remembers what was taken. One instance per Studio process.
 *
 * **Every acquisition is idempotent for the holder.** `App.openProject` takes the lock before a
 * window is built and the window's own startup asks for it again before it reads a document, and
 * both have to be able to ask without the second one being told the first one is in the way.
 */
export class ProjectSessionLockManager {
    private readonly held = new Map<string, HeldLock>();
    private readonly identity: ProjectSessionIdentity;
    private readonly logger: Pick<Console, "info" | "warn">;
    private readonly now: () => number;
    private readonly isProcessAlive: (pid: number) => boolean;
    private readonly heartbeatMs: number;
    private readonly takeoverSettleMs: number;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    /** One acquisition per project at a time, so two callers cannot both write a claim. */
    private readonly claims = new Map<string, Promise<ProjectSessionLockOutcome>>();

    constructor(options: ProjectSessionLockManagerOptions) {
        this.logger = options.logger;
        this.now = options.now ?? (() => Date.now());
        this.isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
        this.heartbeatMs = options.heartbeatMs ?? PROJECT_SESSION_HEARTBEAT_MS;
        this.takeoverSettleMs = options.takeoverSettleMs ?? DEFAULT_TAKEOVER_SETTLE_MS;
        this.identity = {
            pid: options.pid ?? process.pid,
            hostname: options.hostname ?? os.hostname(),
            installation: digestInstallation(options.userDataDir),
        };
    }

    /** Whether this process holds the project. */
    public holds(projectPath: string): boolean {
        return this.held.has(keyFor(projectPath));
    }

    /**
     * Take the project for this session, or report who has it.
     *
     * Returning `{ok: true}` means every later write to this project in this process is the only
     * one anybody is making. Returning a holder means a workspace opened on this project must not
     * read-modify-write anything, which is what the error screen it lands on is for.
     */
    public acquire(projectPath: string): Promise<ProjectSessionLockOutcome> {
        const key = keyFor(projectPath);
        const held = this.held.get(key);
        if (held) {
            return Promise.resolve({ ok: true });
        }

        const inFlight = this.claims.get(key);
        if (inFlight) {
            return inFlight;
        }

        const claim = this.claimLock(projectPath, key).finally(() => {
            if (this.claims.get(key) === claim) {
                this.claims.delete(key);
            }
        });
        this.claims.set(key, claim);
        return claim;
    }

    /**
     * Give the project up.
     *
     * Removes the file only while it still carries this session's record: a lock that was taken
     * over while this process was busy belongs to whoever took it, and deleting it would hand the
     * project to a third Studio while the second one is editing.
     */
    public async release(projectPath: string): Promise<void> {
        const key = keyFor(projectPath);
        const held = this.held.get(key);
        if (!held) {
            return;
        }
        this.held.delete(key);
        this.stopHeartbeatIfIdle();

        try {
            const onDisk = await this.readRecord(held.lockPath);
            if (onDisk !== null && !this.isOwnRecord(onDisk)) {
                return;
            }
            await fs.rm(held.lockPath, { force: true });
        } catch (error) {
            this.logger.warn("[Project] Could not release the session lock on", held.projectPath, error);
        }
    }

    /** Give up every project this session holds. Used by the quit teardown. */
    public async releaseAll(): Promise<void> {
        for (const held of [...this.held.values()]) {
            await this.release(held.projectPath);
        }
    }

    /**
     * The same thing without waiting for the event loop, for an exit that will not come back.
     *
     * A process that is killed outright leaves its record behind and is taken over on the strength
     * of its process id being gone, so this is a courtesy rather than the mechanism: it turns the
     * next open into an ordinary one instead of a takeover that has to be explained in the log.
     */
    public releaseAllSync(): void {
        for (const held of [...this.held.values()]) {
            this.held.delete(keyFor(held.projectPath));
            try {
                const content = fsSync.readFileSync(held.lockPath, "utf-8");
                const onDisk = parseProjectSessionLockRecord(content);
                if (onDisk !== null && !this.isOwnRecord(onDisk)) {
                    continue;
                }
                fsSync.rmSync(held.lockPath, { force: true });
            } catch {
                // An exit is not a place to report a file that was already gone.
            }
        }
        this.stopHeartbeatIfIdle();
    }

    /** Stop the timer. Nothing else holds this manager alive. */
    public dispose(): void {
        if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /**
     * Write this session's heartbeat into every lock it holds.
     *
     * Public so a test can drive it without a timer. A lock that has been taken over is dropped
     * rather than rewritten - the project belongs to the other session now, and stamping this one's
     * heartbeat back over it would take it away again from a Studio that is editing.
     */
    public async beat(): Promise<void> {
        for (const held of [...this.held.values()]) {
            try {
                const onDisk = await this.readRecord(held.lockPath);
                if (onDisk !== null && !this.isOwnRecord(onDisk)) {
                    this.held.delete(keyFor(held.projectPath));
                    this.logger.warn(
                        "[Project] The session lock on", held.projectPath,
                        "was taken over by another NarraLeaf Studio while this one held it.",
                    );
                    continue;
                }
                held.record = { ...held.record, heartbeat: new Date(this.now()).toISOString() };
                await this.writeRecord(held.lockPath, held.record);
            } catch (error) {
                // A missed heartbeat is not a lost project: the staleness window is many beats
                // long, so a disk that stalled has several more attempts before anyone takes it.
                this.logger.warn("[Project] Could not refresh the session lock on", held.projectPath, error);
            }
        }
        this.stopHeartbeatIfIdle();
    }

    private async claimLock(projectPath: string, key: string): Promise<ProjectSessionLockOutcome> {
        const resolved = path.resolve(projectPath);
        const lockPath = path.join(resolved, PROJECT_SESSION_LOCK_RELATIVE_PATH);

        try {
            await fs.mkdir(path.dirname(lockPath), { recursive: true });
        } catch (error) {
            // A project directory that cannot hold a lock file cannot be edited either, but that is
            // a diagnosis for whatever reads a document next: refusing to open here would turn a
            // read-only copy of a project into one that cannot even be looked at.
            this.logger.warn("[Project] Could not create the session lock directory for", resolved, error);
            return { ok: true };
        }

        // Two rounds. The first acts on what is there; the second exists because "there was nothing
        // there" can be answered by another process getting in first, and the answer to that is the
        // record it just wrote rather than a refusal with nothing behind it.
        for (let attempt = 0; attempt < 2; attempt++) {
            const existing = await this.readRecord(lockPath);
            const claim = decideProjectSessionClaim(existing, {
                self: this.identity,
                now: this.now(),
                isProcessAlive: this.isProcessAlive,
            });

            if (claim.kind === "held") {
                return { ok: false, holder: claim.holder };
            }

            if (claim.kind === "stale") {
                this.logger.info(
                    "[Project] Taking over the session lock on", resolved,
                    `- ${claim.reason}.`,
                );
            }

            const taken = claim.kind === "free"
                ? await this.createLock(lockPath)
                : await this.takeOver(lockPath);

            if (taken.outcome === "taken") {
                this.record(key, resolved, lockPath, taken.record);
                return { ok: true };
            }
            if (taken.outcome === "lost") {
                return { ok: false, holder: taken.holder };
            }
            if (taken.outcome === "unwritable") {
                // A project on read-only media, or one whose folder this user may not write to.
                // Nothing is holding it and nothing can be recorded, so it opens unlocked rather
                // than not at all - refusing here would make a project that can only be read into
                // one that cannot even be looked at.
                return { ok: true };
            }
            // "retry": somebody created the file between the read and the write. Round two reads it.
        }

        const settled = await this.readRecord(lockPath);
        if (settled !== null && !this.isOwnRecord(settled)) {
            return { ok: false, holder: describeHolder(settled, settled.hostname === this.identity.hostname) };
        }
        return { ok: true };
    }

    /** Create the file, which only one of two simultaneous callers can do. */
    private async createLock(lockPath: string): Promise<ClaimAttempt> {
        const record = buildProjectSessionLockRecord(this.identity, this.now());
        const created = await Fs.createFileExclusive(lockPath, serializeProjectSessionLockRecord(record));
        if (!created.ok) {
            this.logger.warn("[Project] Could not write the session lock", lockPath, created.error.message);
            return { outcome: "unwritable" };
        }
        return created.data ? { outcome: "taken", record } : { outcome: "retry" };
    }

    /**
     * Replace a record nobody is behind any more.
     *
     * Remove and re-create rather than overwrite, so the create is still the exclusive one - two
     * Studios finding the same abandoned lock at the same moment cannot both write it. The read-back
     * closes the remaining window, where the other one removed this session's brand new file before
     * writing its own: after it, exactly one of the two is holding a record that is on disk, and the
     * other has been told who the holder is.
     */
    private async takeOver(lockPath: string): Promise<ClaimAttempt> {
        await fs.rm(lockPath, { force: true }).catch(() => undefined);
        const created = await this.createLock(lockPath);
        if (created.outcome !== "taken") {
            return created;
        }

        if (this.takeoverSettleMs > 0) {
            await new Promise<void>(resolve => setTimeout(resolve, this.takeoverSettleMs).unref?.());
        }
        const settled = await this.readRecord(lockPath);
        if (settled !== null && !this.isOwnRecord(settled)) {
            return {
                outcome: "lost",
                holder: describeHolder(settled, settled.hostname === this.identity.hostname),
            };
        }
        return created;
    }

    private record(key: string, projectPath: string, lockPath: string, record: ProjectSessionLockRecord): void {
        this.held.set(key, { projectPath, lockPath, record });
        this.startHeartbeat();
    }

    private isOwnRecord(record: ProjectSessionLockRecord): boolean {
        return record.pid === this.identity.pid
            && record.hostname === this.identity.hostname
            && record.installation === this.identity.installation;
    }

    private async readRecord(lockPath: string): Promise<ProjectSessionLockRecord | null> {
        const read = await Fs.read(lockPath);
        if (!read.ok) {
            return null;
        }
        return parseProjectSessionLockRecord(read.data);
    }

    private async writeRecord(lockPath: string, record: ProjectSessionLockRecord): Promise<void> {
        const written = await Fs.write(lockPath, serializeProjectSessionLockRecord(record));
        if (!written.ok) {
            throw new Error(written.error.message);
        }
    }

    private startHeartbeat(): void {
        if (this.heartbeatTimer !== null) {
            return;
        }
        // Unreferenced: a timer is not a reason for the process to stay alive, and this one runs for
        // as long as any project is open.
        this.heartbeatTimer = setInterval(() => void this.beat(), this.heartbeatMs);
        this.heartbeatTimer.unref?.();
    }

    private stopHeartbeatIfIdle(): void {
        if (this.held.size === 0) {
            this.dispose();
        }
    }
}

/** What one attempt to write the lock came to. */
type ClaimAttempt =
    | { outcome: "taken"; record: ProjectSessionLockRecord }
    /** Somebody else created the file in the moment between reading it and writing it. */
    | { outcome: "retry" }
    /** Another session's record is on disk where this one's was written. */
    | { outcome: "lost"; holder: ProjectSessionHolder }
    /** The file could not be written at all. */
    | { outcome: "unwritable" };

/** The identity key: the same normalization every other per-project map in Studio is keyed by. */
function keyFor(projectPath: string): string {
    return normalizeProjectPath(path.resolve(projectPath));
}

/**
 * A digest of the profile directory, short enough to read in a log and never shown anywhere else.
 *
 * The directory itself is a path on somebody's disk, and this file goes wherever the project goes.
 */
function digestInstallation(userDataDir: string): string {
    return createHash("sha256").update(path.resolve(userDataDir)).digest("hex").slice(0, 16);
}

/**
 * Whether a process id is running here.
 *
 * Signal 0 performs the permission and existence checks without delivering anything. `EPERM` means
 * a process that this user may not signal, which is still a process - so only `ESRCH` counts as
 * gone.
 */
function defaultIsProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException)?.code !== "ESRCH";
    }
}
