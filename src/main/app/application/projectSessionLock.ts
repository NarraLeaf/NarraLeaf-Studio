import { createHash } from "crypto";
import path from "path";

import type { ProjectSessionHolder } from "@shared/types/projectSession";
import { normalizeProjectPath } from "@shared/utils/recentProject";

/**
 * One project, one Studio.
 *
 * Electron's single-instance lock already keeps two Studios off one *profile*, and
 * `App.openProject` keeps one project to one window inside a single process. Neither of them says
 * anything about the case this module exists for: two Studios that are not the same process at all
 * - a second profile, a second machine, the same folder reached through a sync client. Every
 * service in the workspace holds a whole document in memory and writes it back wholesale, so two
 * of them on one project is not a merge conflict, it is the later save erasing the earlier one
 * with nothing on screen to say it happened.
 *
 * The claim is a file in the project, because the project is the only thing the two processes
 * share. It carries who holds it and when they last said so, and it is written with
 * `O_EXCL` so that exactly one of two simultaneous claims wins.
 *
 * ## What is in the record, and what is shown
 *
 * The record identifies a *session*, not a person: the process id and the machine, plus a digest of
 * the profile directory so that two Studios on one machine under different profiles are two
 * holders, and a digest of the folder it claims (see "Copies of a project that is open" below). None
 * of that except the machine name and the time reaches the interface - a process id is not something
 * an author can act on, and a digest is not something anybody should ever be shown.
 *
 * ## Staleness
 *
 * A lock is a claim by a process, and processes are killed, panic and lose power without ever
 * getting to remove their file. Two things make a record stale, and a takeover logs which:
 *
 *  - it names a process on THIS machine that is no longer running - the strongest evidence
 *    available, and only meaningful here, since a process id from another host says nothing about
 *    what runs on this one;
 *  - its heartbeat has not moved for {@link PROJECT_SESSION_LOCK_STALE_MS}, which is the only
 *    evidence available for a holder on another machine.
 *
 * The heartbeat interval is far shorter than the staleness window on purpose: a live Studio that
 * misses a write - a disk that stalled, a sync client holding the file - has several more attempts
 * before anybody would take its project away.
 *
 * A stale heartbeat from a process that is still running on this machine gets one more heartbeat
 * period before the takeover (see `ProjectSessionLockManager`), because that Studio is the one
 * most likely to be about to speak: a computer waking from sleep resumes every process on it with
 * a heartbeat as old as the sleep.
 *
 * ## Being taken over
 *
 * The holder is not told; it finds out. Its next heartbeat reads somebody else's record where its
 * own was, stops heartbeating that project, and tells the project's workspace to stop writing -
 * the workspace freezes for good and says the project is now open in another Studio. A holder that
 * is running notices within one heartbeat period; one that was suspended notices on its first
 * heartbeat after it resumes.
 *
 * ## The claim going missing
 *
 * A holder can also find no claim at all where its own was, and that alone says nothing: the file
 * is gone both when somebody cleared out `.nlstudio/` by hand or a sync client dropped it - nobody
 * else was ever here, and the holder should simply write its claim again - and when another Studio
 * took the project over and has since closed it, which removes that Studio's claim on the way out.
 * The second is the takeover again, only found late: the other Studio saved its work over the
 * project, and a holder that wrote its claim back and carried on would save its own stale documents
 * over that work without ever knowing the other one was there. A takeover is normally seen within
 * one heartbeat, but a holder that was suspended can sleep through the other Studio's whole session.
 *
 * Nothing the lock leaves behind tells the two apart, so every claim also leaves a record that
 * outlives it: {@link PROJECT_SESSION_LAST_CLAIM_RELATIVE_PATH} is rewritten with the claimant's
 * record each time a session takes the project, and releasing the project does not remove it. A
 * holder whose claim is missing reads it (see {@link decideHeldProjectSession}): a last claim made
 * by another session after this one's says somebody had the project in between, and the holder stops
 * writing as it would for a takeover it had seen; otherwise it writes its claim again and carries on.
 * Modification times of the project's documents were not used for this - nothing on disk says which
 * Studio wrote a file, and sync clients and version control touch them for reasons of their own.
 *
 * A Studio from before the last-claim record never writes one, so a takeover by one of those that
 * has already closed again still goes unnoticed; every claim this version makes is covered.
 *
 * ## Copies of a project that is open
 *
 * The claim is a file inside the project, so anything that copies the folder copies the claim with
 * it: an Explorer copy, a backup, a zip sent to a colleague. The copy is a folder nobody has open,
 * but its lock names a Studio that is running and heartbeating - the original folder, not this one -
 * so until that record's heartbeat went stale the copy could not be opened.
 *
 * So a record also says which folder it claims ({@link ProjectSessionLockRecord.directory}), and a
 * record found in a folder other than the one it names is not a claim on that folder at all: it is
 * taken over without a word, as a claim by a process that has gone would be. The same goes for a
 * last-claim record, which says nothing about who has had this folder if it was made on another.
 *
 * Only for a record written on THIS machine. A path is only comparable with another path on the
 * machine that resolved it: the same project reached through a sync client, or through a network
 * share mounted somewhere else, is one folder under two different paths on two machines - and that is
 * exactly the second writer this lock exists to keep out. A copy that carries a claim from another
 * machine is judged on its heartbeat, as every claim from there always was, so it opens once the
 * frozen heartbeat is {@link PROJECT_SESSION_LOCK_STALE_MS} old - which a copy that went through an
 * archive or an upload usually already is.
 *
 * A record from a Studio that did not write the folder is a claim as it always was. That Studio may
 * be running and holding the project right now, and a claim that cannot be checked is not one to wave
 * through; a copy made from under one of those still waits for the heartbeat.
 */

/** Where the claim lives, relative to the project directory. */
export const PROJECT_SESSION_LOCK_RELATIVE_PATH = path.join(".nlstudio", "session.lock");

/**
 * Where the last claim anybody made on the project is kept, relative to the project directory.
 *
 * The same record as the lock's, written once when a session takes the project and never removed, so
 * that a holder that finds its claim gone can tell whether somebody else had the project meanwhile.
 * Under `.nlstudio/` with the lock, which version control and an export both leave out.
 */
export const PROJECT_SESSION_LAST_CLAIM_RELATIVE_PATH = path.join(".nlstudio", "session.last");

/** How often a held lock rewrites its heartbeat. */
export const PROJECT_SESSION_HEARTBEAT_MS = 15_000;

/** How long a heartbeat may stand still before the session behind it is presumed gone. */
export const PROJECT_SESSION_LOCK_STALE_MS = 120_000;

/** The claim as it sits on disk. */
export interface ProjectSessionLockRecord {
    /** The process holding the project, on {@link ProjectSessionLockRecord.hostname}. */
    pid: number;
    /** The machine, as the operating system reports it. */
    hostname: string;
    /**
     * A digest of the holder's profile directory.
     *
     * Two Studios on one machine can be two profiles (a development build beside an installed one,
     * a build agent with a profile of its own), and they are as much two writers as two machines
     * are. The directory is digested rather than stored because it is a path on somebody's disk and
     * this file travels with the project.
     */
    installation: string;
    /** When this session took the project, ISO-8601. */
    startedAt: string;
    /** When it last said it was still here, ISO-8601. */
    heartbeat: string;
    /**
     * A digest of the folder this claim was made on, as the claiming machine resolves it - see
     * {@link digestProjectDirectory}.
     *
     * What tells a claim on this folder from one that was copied into it along with the project.
     * Digested for the same reason as {@link installation}: the path is somebody's disk, and this
     * file goes wherever the project goes. Absent from a record written before it existed, and such
     * a record is a claim on whatever folder it is found in.
     */
    directory?: string;
}

/** Who this process is, as a lock record identifies it. */
export interface ProjectSessionIdentity {
    pid: number;
    hostname: string;
    installation: string;
}

/** What a claim against an existing record comes to. */
export type ProjectSessionClaim =
    /** Nothing is holding this project. */
    | { kind: "free" }
    /** This process wrote the record that is there. */
    | { kind: "own" }
    /**
     * Somebody's record is there, and there is reason to believe nobody is behind it.
     *
     * `holderRunning` is set when the only evidence is the heartbeat and the process the record
     * names is still running on this machine. That Studio may be merely late rather than gone -
     * the moment a computer wakes from sleep, every process on it has a heartbeat minutes old and
     * is about to write a new one - so the caller looks again one heartbeat later before taking
     * the project away from it.
     */
    | { kind: "stale"; reason: string; holderRunning: boolean }
    /**
     * The record claims another folder on this machine: it came along when the project was copied,
     * and says nothing about this one. Taken over at once and without a word, whoever wrote it and
     * whether or not that Studio is still running - it is holding the original, not this copy.
     */
    | { kind: "copied" }
    /** Another session holds it, and is still saying so. */
    | { kind: "held"; holder: ProjectSessionHolder };

/** What {@link decideProjectSessionClaim} needs to know about the world. */
export interface ProjectSessionClaimContext {
    /** This process's identity. */
    self: ProjectSessionIdentity;
    /** Now, in milliseconds since the epoch. */
    now: number;
    /** Whether a process id is running on THIS machine. */
    isProcessAlive: (pid: number) => boolean;
    /** The folder the record was found in, digested the way a record states its own. */
    directory: string;
}

/**
 * Whether the record on disk stands in the way of this process taking the project.
 *
 * Pure, and separated from the file handling because every rule that decides whether an author is
 * let into their own project is a rule worth testing without a filesystem.
 *
 * A record that cannot be understood - truncated, half-written, from a version that wrote something
 * else - is treated as free rather than as a holder. The alternative is a project nobody can open
 * because of a file nobody can read, and the writer of a damaged record is by definition not
 * heartbeating it.
 */
export function decideProjectSessionClaim(
    record: ProjectSessionLockRecord | null,
    context: ProjectSessionClaimContext,
): ProjectSessionClaim {
    if (record === null) {
        return { kind: "free" };
    }

    const sameHost = record.hostname === context.self.hostname;
    // Before anything about who wrote it: a record about another folder is not about this one,
    // even when it was this very process that wrote it there.
    if (!claimsDirectory(record, context.self, context.directory)) {
        return { kind: "copied" };
    }
    if (isRecordOf(record, context.self)) {
        return { kind: "own" };
    }

    const holderRunning = sameHost && context.isProcessAlive(record.pid);
    if (sameHost && !holderRunning) {
        return { kind: "stale", reason: "the process that held it is no longer running", holderRunning: false };
    }

    const heartbeatAge = context.now - Date.parse(record.heartbeat);
    // NaN when the timestamp is unreadable, and a negative age when the holder's clock runs ahead
    // of this one; neither is evidence that the holder is gone, so neither takes the project away.
    if (Number.isFinite(heartbeatAge) && heartbeatAge > PROJECT_SESSION_LOCK_STALE_MS) {
        return {
            kind: "stale",
            reason: `it has not been refreshed for ${Math.round(heartbeatAge / 1000)}s`,
            // Only knowable here. A process id from another machine says nothing about this one,
            // so a remote holder is judged on its heartbeat alone, as it always was.
            holderRunning,
        };
    }

    return { kind: "held", holder: describeHolder(record, sameHost) };
}

/** What a heartbeat makes of the disk, for a project this process holds. */
export type HeldProjectSessionState =
    /** This session's claim is where it left it. Renew the heartbeat. */
    | { kind: "own" }
    /** Another session's claim is where this one's was. */
    | { kind: "taken-over"; by: ProjectSessionLockRecord }
    /**
     * Another session's record is where this one's was, but it claims another folder on this
     * machine: it was copied in over this project's own files, and claims nothing here. Written over,
     * as a record nobody can read is.
     */
    | { kind: "stray" }
    /**
     * This session's claim is gone, and the last claim on the project was made by another session
     * after this one made its own: somebody had the project in between, and has let go of it since.
     * The same loss as a takeover, found after the fact.
     */
    | { kind: "displaced"; by: ProjectSessionLockRecord }
    /** This session's claim is gone and nothing says anybody else has had the project. Claim it again. */
    | { kind: "reclaim" };

/** What {@link decideHeldProjectSession} needs to know besides the two files. */
export interface HeldProjectSessionContext {
    /** This process's identity. */
    self: ProjectSessionIdentity;
    /**
     * The last claim as it stood once this session had taken the project: this session's own
     * record, or - when writing it failed - whatever was there already. A last claim that is still
     * this one is not news, whoever it names.
     */
    lastClaimAtOwnClaim: ProjectSessionLockRecord | null;
    /** The folder this session holds, digested the way a record states its own. */
    directory: string;
}

/**
 * Whether a project this process holds is still its own, and what to do when its claim is gone.
 *
 * Pure for the same reason as {@link decideProjectSessionClaim}. `lock` is the record in the lock
 * file, `null` when the file is missing or cannot be read; `lastClaim` is the record in
 * {@link PROJECT_SESSION_LAST_CLAIM_RELATIVE_PATH}, `null` likewise, and consulted only when `lock`
 * is `null`.
 *
 * A missing last-claim record is no evidence of anybody: it is what a cleared `.nlstudio/` looks
 * like, and what a project last opened by a Studio from before the record existed looks like. Only
 * a record naming some other session, and not the one that was there when this session claimed,
 * says that another Studio took the project after this one did - and only when it was made on this
 * folder: one that names another folder on this machine came in with copied files.
 */
export function decideHeldProjectSession(
    lock: ProjectSessionLockRecord | null,
    lastClaim: ProjectSessionLockRecord | null,
    context: HeldProjectSessionContext,
): HeldProjectSessionState {
    if (lock !== null) {
        if (isRecordOf(lock, context.self)) {
            return { kind: "own" };
        }
        return claimsDirectory(lock, context.self, context.directory)
            ? { kind: "taken-over", by: lock }
            : { kind: "stray" };
    }

    if (
        lastClaim === null
        || isRecordOf(lastClaim, context.self)
        || !claimsDirectory(lastClaim, context.self, context.directory)
        || (context.lastClaimAtOwnClaim !== null && isSameClaim(lastClaim, context.lastClaimAtOwnClaim))
    ) {
        return { kind: "reclaim" };
    }
    return { kind: "displaced", by: lastClaim };
}

/** Whether a record was written by the process `identity` describes. */
export function isRecordOf(record: ProjectSessionLockRecord, identity: ProjectSessionIdentity): boolean {
    return record.pid === identity.pid
        && record.hostname === identity.hostname
        && record.installation === identity.installation;
}

/**
 * Whether a record found in the folder `directory` is a claim on that folder, as far as this machine
 * can tell.
 *
 * Yes unless it was written here and names another folder - see "Copies of a project that is open"
 * above for why a record from another machine, and one from a Studio that did not write the folder,
 * are both taken at their word.
 */
export function claimsDirectory(
    record: ProjectSessionLockRecord,
    self: ProjectSessionIdentity,
    directory: string,
): boolean {
    if (record.directory === undefined || record.hostname !== self.hostname) {
        return true;
    }
    return record.directory === directory;
}

/**
 * The digest a record states its folder by, from the folder's canonical path on this machine.
 *
 * The caller resolves the path first - links, junctions, a drive letter mapped onto a share, the
 * spelling the file system itself uses (see `ProjectSessionLockManager`) - because two spellings of
 * one folder that digested differently would read as a copy, and let a second Studio in beside the
 * first. {@link normalizeProjectPath} then folds what is left the way every other per-project key in
 * Studio is folded. Sixteen hex digits, like the profile digest: enough to tell folders apart, and
 * nothing a reader could turn back into a path.
 */
export function digestProjectDirectory(canonicalPath: string): string {
    return createHash("sha256").update(normalizeProjectPath(canonicalPath)).digest("hex").slice(0, 16);
}

/**
 * Whether two records are the same claim - one session taking the project once.
 *
 * The heartbeat is left out: it is the one field that moves while the claim stays the same.
 */
function isSameClaim(a: ProjectSessionLockRecord, b: ProjectSessionLockRecord): boolean {
    return isRecordOf(a, b) && a.startedAt === b.startedAt;
}

/** The part of a record a workspace window may be told about. */
export function describeHolder(record: ProjectSessionLockRecord, sameHost: boolean): ProjectSessionHolder {
    return {
        hostname: record.hostname,
        startedAt: record.startedAt,
        sameHost,
    };
}

/** The record this process would write, taking the project in the folder `directory` now. */
export function buildProjectSessionLockRecord(
    self: ProjectSessionIdentity,
    now: number,
    directory: string,
): ProjectSessionLockRecord {
    const timestamp = new Date(now).toISOString();
    return {
        pid: self.pid,
        hostname: self.hostname,
        installation: self.installation,
        startedAt: timestamp,
        heartbeat: timestamp,
        directory,
    };
}

/**
 * Read a record out of the bytes on disk, or nothing.
 *
 * Every field is checked rather than trusted: this file is inside the author's project, so it
 * travels through sync clients, archives and other people's machines, and a `pid` that arrived as a
 * string would otherwise be compared against a number and silently never match.
 */
export function parseProjectSessionLockRecord(content: string): ProjectSessionLockRecord | null {
    let value: unknown;
    try {
        value = JSON.parse(content);
    } catch {
        return null;
    }

    if (typeof value !== "object" || value === null) {
        return null;
    }

    const candidate = value as Partial<ProjectSessionLockRecord>;
    if (
        typeof candidate.pid !== "number"
        || !Number.isInteger(candidate.pid)
        || typeof candidate.hostname !== "string"
        || typeof candidate.installation !== "string"
        || typeof candidate.startedAt !== "string"
        || typeof candidate.heartbeat !== "string"
    ) {
        return null;
    }

    return {
        pid: candidate.pid,
        hostname: candidate.hostname,
        installation: candidate.installation,
        startedAt: candidate.startedAt,
        heartbeat: candidate.heartbeat,
        // Left off when it is not a string rather than failing the record: nothing writes that, and
        // a record that says nothing about its folder is still a claim, which is the side to err on.
        ...(typeof candidate.directory === "string" ? { directory: candidate.directory } : {}),
    };
}

/** The record as it is written. Indented because a person reading a project folder may find it. */
export function serializeProjectSessionLockRecord(record: ProjectSessionLockRecord): string {
    return `${JSON.stringify(record, null, 2)}\n`;
}
