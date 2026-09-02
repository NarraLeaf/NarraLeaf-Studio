/**
 * What a workspace window is told when another NarraLeaf Studio already holds its project.
 *
 * Deliberately the smallest thing that can be said about the other session: the machine it is on
 * and when it started. The record on disk also carries a process id and a digest of the holder's
 * profile directory, and neither may cross into a renderer - an author cannot act on either, and
 * an identifier of that shape has no place on the interface.
 */
export interface ProjectSessionHolder {
    /** The machine holding the project, as its operating system reports it. */
    hostname: string;
    /** When that session took the project, ISO-8601. */
    startedAt: string;
    /** Whether that machine is this one. */
    sameHost: boolean;
}

/** The answer to "may this window edit this project". */
export type ProjectSessionLockOutcome =
    | { ok: true }
    | { ok: false; holder: ProjectSessionHolder };
