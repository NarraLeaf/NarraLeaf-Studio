import path from "path";

import type { ProjectSessionHolder } from "@shared/types/projectSession";

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
 * holders. None of that except the machine name and the time reaches the interface - a process id
 * is not something an author can act on, and a digest is not something anybody should ever be
 * shown.
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
 */

/** Where the claim lives, relative to the project directory. */
export const PROJECT_SESSION_LOCK_RELATIVE_PATH = path.join(".nlstudio", "session.lock");

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
    /** Somebody's record is there, and there is reason to believe nobody is behind it. */
    | { kind: "stale"; reason: string }
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
    if (sameHost && record.installation === context.self.installation && record.pid === context.self.pid) {
        return { kind: "own" };
    }

    if (sameHost && !context.isProcessAlive(record.pid)) {
        return { kind: "stale", reason: "the process that held it is no longer running" };
    }

    const heartbeatAge = context.now - Date.parse(record.heartbeat);
    // NaN when the timestamp is unreadable, and a negative age when the holder's clock runs ahead
    // of this one; neither is evidence that the holder is gone, so neither takes the project away.
    if (Number.isFinite(heartbeatAge) && heartbeatAge > PROJECT_SESSION_LOCK_STALE_MS) {
        return {
            kind: "stale",
            reason: `it has not been refreshed for ${Math.round(heartbeatAge / 1000)}s`,
        };
    }

    return { kind: "held", holder: describeHolder(record, sameHost) };
}

/** The part of a record a workspace window may be told about. */
export function describeHolder(record: ProjectSessionLockRecord, sameHost: boolean): ProjectSessionHolder {
    return {
        hostname: record.hostname,
        startedAt: record.startedAt,
        sameHost,
    };
}

/** The record this process would write, taking the project now. */
export function buildProjectSessionLockRecord(
    self: ProjectSessionIdentity,
    now: number,
): ProjectSessionLockRecord {
    const timestamp = new Date(now).toISOString();
    return {
        pid: self.pid,
        hostname: self.hostname,
        installation: self.installation,
        startedAt: timestamp,
        heartbeat: timestamp,
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
    };
}

/** The record as it is written. Indented because a person reading a project folder may find it. */
export function serializeProjectSessionLockRecord(record: ProjectSessionLockRecord): string {
    return `${JSON.stringify(record, null, 2)}\n`;
}
