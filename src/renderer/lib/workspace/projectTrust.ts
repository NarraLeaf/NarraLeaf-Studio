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
 * # Memoized per path, except when the question was never answered
 *
 * Trust is settled when a workspace starts, the same way recovery mode is, and revoking a grant
 * takes effect on the next launch. So one answer per path for the life of the window is not a cache
 * that can go stale - it is the semantics. It also removes a whole class of ordering bug: callers
 * await the same promise rather than racing a "not seeded yet" state.
 *
 * The exception is a query that produced no answer at all. "Distrusted" and "the question did not
 * get through" are both `false` to a caller, and only the first is a fact about the project: a
 * dropped IPC call remembered as a "no" would leave a window whose puppets, probes and previews are
 * all quietly off, for a reason nothing on screen explains. So an answer main actually gave is kept
 * whichever way it went - and the "no" is the case this module exists for, now read on every editor
 * tab mount, by the media scan, by the puppet loader and by several top-bar components - while a
 * failure is forgotten and asked again on the next call.
 */

const answers = new Map<string, Promise<boolean>>();

/**
 * Whether this project is trusted, asked once.
 *
 * Fails **closed**: a query that throws, or that comes back unsuccessful, answers "not trusted".
 * Absence of an answer is not evidence of safety, and the one thing this guards - executing the
 * project's own JavaScript - is not worth doing on a guess. That fail-closed `false` is the one
 * answer not kept, so a transient IPC failure does not distrust the project for the rest of the
 * session; see the note on memoization above.
 */
export function isProjectTrusted(projectPath: string): Promise<boolean> {
    const existing = answers.get(projectPath);
    if (existing) {
        return existing;
    }
    const pending = askMain(projectPath);
    answers.set(projectPath, pending);
    return pending;
}

/**
 * One trip to main, which forgets itself unless main answered.
 *
 * The `delete` sits after an await, so it can only run once the caller above has stored this
 * promise - a failure therefore leaves the map empty rather than racing the store and leaving the
 * unanswered attempt behind for every later caller to read.
 */
async function askMain(projectPath: string): Promise<boolean> {
    try {
        const result = await getInterface().projectTrust.query(projectPath);
        if (result.success) {
            // Kept whichever way it went. A distrusted project is asked about once, not once per
            // caller, which is the whole point of the map.
            return result.data.trusted;
        }
    } catch {
        // Falls through to the same place an unsuccessful result does: neither is an answer, and
        // the two are indistinguishable to a caller anyway.
    }
    answers.delete(projectPath);
    return false;
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
