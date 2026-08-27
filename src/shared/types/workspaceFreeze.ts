import type { WorkspaceFreezeKind } from "./ipcEvents";

/**
 * Which kinds of freeze stop Studio *starting* things, as opposed to stopping project data being
 * written.
 *
 * The two questions are genuinely different, and this module is only the first of them. Whether a
 * byte may be written is decided at the renderer's write boundary (`@/lib/app/writeFreeze`); whether
 * a production build, the preview, a patch export or a test's game may be launched is decided here
 * and answered identically on both sides of the process boundary.
 *
 * **Shared, rather than one copy per process, because both sides answer it about the same moment.**
 * The main process owns the refusal - the operations are started there, and a keybinding, a plugin
 * or a second window can ask for one whatever the top bar looks like. The renderer owns the
 * affordance: the Run split-button, the Build row, the macOS Develop menu and the command palette
 * all decide from this whether to grey themselves out. Two copies of the answer produce the one
 * outcome neither side wants - a control greyed out for an operation main would have started, which
 * is a dead button, and a dead button is worse than either honest state.
 */

/**
 * The kinds of freeze that make Studio refuse those operations - which is every kind but one.
 *
 * The exception is `live-session`. The refusal is a **consistency** guard: it exists because the
 * author is reading something other than their working tree and would have no way to know the build
 * was not of it. In a live session that sentence is false - the working tree is exactly what
 * everybody in the session is looking at, kept current by the effects arriving from the host - so
 * there is nothing to guard against, and refusing would only take running the game away from a
 * collaborator for as long as the session lasts.
 *
 * Named as a type rather than checked inline at each call site so that the sentences the author
 * reads (`workspaceFrozenMessage`, in main) can be exhaustive over it: a sixth kind that does refuse
 * has to say what the author is told, and the compiler is what asks.
 */
export type WorkspaceRefusingFreezeKind = Exclude<WorkspaceFreezeKind, "live-session">;

/**
 * Whether this kind of freeze is one that stops Studio starting things.
 *
 * Every call site asks this rather than each spelling out which kinds are exempt: a comparison
 * written eight times is a comparison that will one day be written seven times, and the half that
 * forgot is the half that greys out a control the other half would have run.
 */
export function refusesOperations(kind: WorkspaceFreezeKind): kind is WorkspaceRefusingFreezeKind {
    return kind !== "live-session";
}
