import { getInterface } from "@/lib/app/bridge";
import { PROJECT_DISTRUSTED_REASON } from "@shared/types/projectTrust";

/**
 * Whether the project this window is open on may cause effects, as far as the renderer knows.
 *
 * # This is not the boundary
 *
 * Main holds the ledger and main is what refuses a build, a preview, a spawn. What lives here is
 * the renderer's copy, and it exists for two things a main-side refusal cannot do: stop offering a
 * control that would be refused, and stop the renderer from doing the one dangerous thing main
 * never sees - `import()`ing a module out of the project. That import happens entirely inside the
 * renderer; no IPC crosses, so there is nothing for main to say no to.
 *
 * A renderer's copy of a security answer is worth having only when the thing it guards is also in
 * the renderer. Everything else must ask main.
 *
 * # Memoized per path, and deliberately never invalidated
 *
 * Trust is settled when a workspace starts, the same way recovery mode is, and revoking a grant
 * takes effect on the next launch. So one answer per path for the life of the window is not a cache
 * that can go stale - it is the semantics. It also removes a whole class of ordering bug: callers
 * await the same promise rather than racing a "not seeded yet" state.
 */

const answers = new Map<string, Promise<boolean>>();

/**
 * Whether this project is trusted, asked once.
 *
 * Fails **closed**: a query that errors answers "not trusted". Absence of an answer is not evidence
 * of safety, and the one thing this guards - executing the project's own JavaScript - is not worth
 * doing on a guess. The failed answer is not memoized, so a transient IPC failure does not distrust
 * the project for the rest of the session.
 */
export function isProjectTrusted(projectPath: string): Promise<boolean> {
    const existing = answers.get(projectPath);
    if (existing) {
        return existing;
    }
    const pending = getInterface().projectTrust.query(projectPath)
        .then(result => (result.success ? result.data.trusted : false))
        .catch(() => false);
    answers.set(projectPath, pending);
    return pending.then(trusted => {
        if (!trusted) {
            // Only a positive answer is worth keeping: a "no" that came from a failed query would
            // otherwise stick for the window's whole life.
            answers.delete(projectPath);
        }
        return trusted;
    });
}

/** Thrown where a distrusted project would otherwise have had its code run. */
export class ProjectDistrustedError extends Error {
    public readonly reason = PROJECT_DISTRUSTED_REASON;

    constructor(what: string) {
        super(`This project is not trusted, so Studio will not ${what}. Trust it in Settings to allow it.`);
        this.name = "ProjectDistrustedError";
    }
}

/** Refuse unless the author has vouched for this project. */
export async function requireProjectTrust(projectPath: string, what: string): Promise<void> {
    if (!await isProjectTrusted(projectPath)) {
        throw new ProjectDistrustedError(what);
    }
}

/** Testing seam: forget every answer so a case can set up a different one. */
export function resetProjectTrustCacheForTests(): void {
    answers.clear();
}
