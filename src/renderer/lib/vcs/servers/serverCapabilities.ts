import type { VcsServerCapability, VcsServerSession } from "@shared/types/vcs";

/**
 * Whether a server offers something, asked before it is asked for.
 *
 * **A capability is checked, never probed.** The alternative is to call and read the 404,
 * and that is wrong twice over: it spends a request on every server that has not been
 * upgraded, and it turns "this deployment does not do that" into a failure with a
 * sentence attached. There is nothing an author does about a server that does not offer
 * members, so there is nothing to tell them - the section is simply not there, exactly as
 * it is not there for a Studio that has not been asked to draw one.
 *
 * A session records what its server answered when it was added or last refreshed, and
 * `vcs.refreshServer` is what brings that up to date; the Servers tab does it once per
 * server per visit. Until then a session stored before Studio kept any of this has no
 * list at all, and that reads as offering nothing - the safe direction, because the only
 * cost is a section appearing a moment later, where the other direction is a request to a
 * server that will refuse it.
 */
export function serverCan(
    session: VcsServerSession | null | undefined,
    capability: VcsServerCapability,
): boolean {
    return session?.capabilities?.includes(capability) === true;
}
