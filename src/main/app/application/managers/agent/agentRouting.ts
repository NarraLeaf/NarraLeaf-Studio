/**
 * Which open workspace an agent's call goes to.
 *
 * Pure, so the rule can be read and tested apart from the windows it chooses between:
 *
 *   1. A call that names a project goes to the window that has that project open - compared by the
 *      same identity Studio keys every project window on - or nowhere. Falling back to another
 *      project here would write one game's scene into another's.
 *   2. A call that names none goes to the workspace the author used last, which is the one they are
 *      looking at and the one "this project" means in conversation.
 *   3. With no focus history at all, exactly one open workspace is unambiguous.
 *
 * Anything else is refused with the open projects listed, so the agent can name one. And before
 * any of it, a write that names no project while several are open is refused outright - see
 * {@link writeNeedsNamedProject}.
 */

export type AgentRoutingCandidate<W> = {
    window: W;
    projectPath: string;
    /** When the window last took focus, in ms; 0 when it never has during this run. */
    lastFocusedAt: number;
};

export type AgentRoutingChoice<W> =
    | { ok: true; window: W; projectPath: string }
    | { ok: false; reason: "not-open" | "none-open" | "ambiguous"; openProjects: string[] };

export function chooseAgentWorkspace<W>(
    requestedProject: string | null,
    candidates: readonly AgentRoutingCandidate<W>[],
    identity: (projectPath: string) => string,
): AgentRoutingChoice<W> {
    const openProjects = candidates.map(candidate => candidate.projectPath);
    if (requestedProject) {
        const target = identity(requestedProject);
        const match = candidates.find(candidate => identity(candidate.projectPath) === target);
        return match
            ? { ok: true, window: match.window, projectPath: match.projectPath }
            : { ok: false, reason: candidates.length === 0 ? "none-open" : "not-open", openProjects };
    }
    if (candidates.length === 0) {
        return { ok: false, reason: "none-open", openProjects };
    }
    const focused = candidates
        .filter(candidate => candidate.lastFocusedAt > 0)
        .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0];
    if (focused) {
        return { ok: true, window: focused.window, projectPath: focused.projectPath };
    }
    if (candidates.length === 1) {
        return { ok: true, window: candidates[0].window, projectPath: candidates[0].projectPath };
    }
    return { ok: false, reason: "ambiguous", openProjects };
}

/**
 * Whether a call must name its project before it is routed at all: a write, while more than one
 * project is open.
 *
 * Rule 2 is right for a read - its answer says what it read, and nothing changed - but not for a
 * write. Focus is the author's, and they may click into the other project between two of the
 * agent's calls; the write then lands in the wrong game. `baseRevision` does not catch it, because
 * revisions are counted per window and the other project's scene can carry the same number.
 */
export function writeNeedsNamedProject(write: boolean, requestedProject: string | null, openCount: number): boolean {
    return write && !requestedProject && openCount > 1;
}
