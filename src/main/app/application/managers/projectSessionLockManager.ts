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
    /**
     * How long to keep watching a silent claim whose process is still running on this machine
     * before taking it over. One heartbeat period unless a test says otherwise - see
     * {@link ProjectSessionLockManager.claimLock}.
     */
    staleConfirmMs?: number;
    /** How the manager waits. Replaceable so a test can act inside the wait instead of sitting it out. */
    sleep?: (ms: number) => Promise<void>;
    /**
     * Called when a heartbeat finds that another Studio has taken over a project this one held.
     *
     * The manager has already stopped heartbeating the project and records it as held elsewhere
     * by then; what is left is the part only the app can do - telling the project's window to stop
     * writing. Called once per takeover.
     */
    onTakenOver?: (projectPath: string, holder: ProjectSessionHolder) => void;
}

/** How long a takeover waits before reading back what it wrote. */
const DEFAULT_TAKEOVER_SETTLE_MS = 150;

function defaultSleep(ms: number): Promise<void> {
    // Unreferenced, like the heartbeat: a wait inside a claim is not a reason to keep a quitting
    // process alive.
    return new Promise<void>(resolve => setTimeout(resolve, ms).unref?.());
}

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
    /**
     * Projects this Studio asked for and was told another one has, with who that is.
     *
     * Kept because a refused window does not go away. It stays up on its error screen, still named
     * after the project, and the main process answers requests from it like any other window of
     * that project - which is how a Dev Mode came to be started on a project whose workspace never
     * did, and every asset in it failed to resolve through a workspace that was not there. See
     * {@link heldElsewhere}, which is what the runtimes ask before they start.
     *
     * Only a refusal is remembered. A claim that could not be made at all - a folder that cannot
     * hold a lock file - opens the project unlocked, and is not something to refuse later either.
     *
     * A project this Studio held and then lost to a takeover is remembered here too (see
     * {@link loseTo}): its window is still up, and the other Studio has the project exactly as it
     * would have if this one had been refused at the door.
     */
    private readonly refused = new Map<string, ProjectSessionHolder>();
    private readonly identity: ProjectSessionIdentity;
    private readonly logger: Pick<Console, "info" | "warn">;
    private readonly now: () => number;
    private readonly isProcessAlive: (pid: number) => boolean;
    private readonly heartbeatMs: number;
    private readonly takeoverSettleMs: number;
    private readonly staleConfirmMs: number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly onTakenOver: ((projectPath: string, holder: ProjectSessionHolder) => void) | null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    /** One acquisition per project at a time, so two callers cannot both write a claim. */
    private readonly claims = new Map<string, Promise<ProjectSessionLockOutcome>>();

    constructor(options: ProjectSessionLockManagerOptions) {
        this.logger = options.logger;
        this.now = options.now ?? (() => Date.now());
        this.isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
        this.heartbeatMs = options.heartbeatMs ?? PROJECT_SESSION_HEARTBEAT_MS;
        this.takeoverSettleMs = options.takeoverSettleMs ?? DEFAULT_TAKEOVER_SETTLE_MS;
        this.staleConfirmMs = options.staleConfirmMs ?? this.heartbeatMs;
        this.sleep = options.sleep ?? defaultSleep;
        this.onTakenOver = options.onTakenOver ?? null;
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
     * The other Studio that has this project, when this one was last told it may not.
     *
     * `null` both for a project this process holds and for one it has never been refused - which
     * includes a project opened unlocked because its folder would not take a lock file. The
     * question it answers is "was this Studio turned away from the project", not "does it hold it":
     * the second would refuse to run a project from a read-only volume, which opens by design.
     *
     * The answer is the last claim's - or the takeover's, when a heartbeat found the project gone -
     * and changes only with the next claim. A window on the error screen keeps being refused after
     * the other Studio closes, until Retry claims again - which is right, because that window's
     * workspace has still not started (or, after a takeover, has stopped), and nothing that needs
     * one can run beside it.
     */
    public heldElsewhere(projectPath: string): ProjectSessionHolder | null {
        return this.refused.get(keyFor(projectPath)) ?? null;
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

        const claim = this.claimLock(projectPath, key).then(outcome => {
            // Every answer replaces the last one, so Retry that gets in clears what the first
            // refusal recorded, and a refusal after an unlocked open records the new holder.
            if (outcome.ok) {
                this.refused.delete(key);
            } else {
                this.refused.set(key, outcome.holder);
            }
            return outcome;
        }).finally(() => {
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
        // The project has no window left in this Studio, refused or not. The next window to ask
        // claims afresh, and until then there is nothing here for a refusal to protect.
        this.refused.delete(key);
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
     *
     * Dropping it is not the whole answer, though, and for a long time it was: the log said the
     * project had been taken over and the workspace went on editing and saving, so two Studios were
     * writing one project with nothing on screen in either. A takeover now also records the project
     * as held elsewhere - so everything {@link heldElsewhere} guards refuses it, as for any project
     * another Studio has - and is reported through `onTakenOver`, which is how its window learns to
     * stop writing.
     */
    public async beat(): Promise<void> {
        for (const held of [...this.held.values()]) {
            try {
                const onDisk = await this.readRecord(held.lockPath);
                if (onDisk !== null && !this.isOwnRecord(onDisk)) {
                    this.loseTo(held, onDisk);
                    continue;
                }
                if (this.held.get(keyFor(held.projectPath)) !== held) {
                    // Lost or released while the read was out - a beat that overlapped this one
                    // found the takeover first. Writing now would stamp this session back over
                    // the Studio that has the project.
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

            if (claim.kind === "stale" && claim.holderRunning && existing !== null) {
                // The heartbeat is the only evidence against a holder whose process is still
                // running here, and it is weakest exactly when it matters most: a computer that has
                // just woken resumes every Studio on it at once, each with a heartbeat as old as the
                // sleep and each about to write a new one. So watch for one heartbeat period before
                // acting. A holder that is really there speaks in that time, and this claim is
                // refused as it should be; one that stays silent is taken over as before.
                this.logger.info(
                    "[Project] The session lock on", resolved,
                    `is held by a Studio that is still running but ${claim.reason};`,
                    `looking again in ${Math.round(this.staleConfirmMs / 1000)}s before taking it over.`,
                );
                await this.sleep(this.staleConfirmMs);
                const later = await this.readRecord(lockPath);
                if (!sameRecord(later, existing)) {
                    // It spoke, let go, or somebody else got in while this one waited. Whichever it
                    // was, the next round decides on what is there now.
                    continue;
                }
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

    /**
     * Give up a project whose claim another Studio has written over, and say so.
     *
     * Once per takeover: two heartbeats can overlap on a disk slow enough to have let a takeover
     * happen at all, and both would find the same foreign record.
     */
    private loseTo(held: HeldLock, onDisk: ProjectSessionLockRecord): void {
        const key = keyFor(held.projectPath);
        if (this.held.get(key) !== held) {
            return;
        }
        this.held.delete(key);
        const holder = describeHolder(onDisk, onDisk.hostname === this.identity.hostname);
        // Refused from now on, exactly as a claim that met this record would have been: the
        // project is the other Studio's, and nothing this one could start on it - Dev Mode, a
        // preview, a build - may run beside it.
        this.refused.set(key, holder);
        this.logger.warn(
            "[Project] The session lock on", held.projectPath,
            "was taken over by another NarraLeaf Studio while this one held it; its workspace stops writing.",
        );
        if (!this.onTakenOver) {
            return;
        }
        try {
            this.onTakenOver(held.projectPath, holder);
        } catch (error) {
            this.logger.warn("[Project] Could not report the takeover of", held.projectPath, error);
        }
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

/**
 * Whether two reads found the same claim, heartbeat and all.
 *
 * Every field rather than the heartbeat alone: a holder that let go and a new one that took the
 * project in the same instant would otherwise read as the first one having stayed silent.
 */
function sameRecord(a: ProjectSessionLockRecord | null, b: ProjectSessionLockRecord | null): boolean {
    if (a === null || b === null) {
        return a === b;
    }
    return a.pid === b.pid
        && a.hostname === b.hostname
        && a.installation === b.installation
        && a.startedAt === b.startedAt
        && a.heartbeat === b.heartbeat;
}

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
