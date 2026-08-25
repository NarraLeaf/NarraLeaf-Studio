/**
 * NarraLeaf Team, as the workspace sees it.
 *
 * Two surfaces, for two questions that move at different speeds. The cell in the bottom-left corner
 * and the dialog behind it own the rare ones the version rail used to carry beside Send and Get:
 * which server this project's versions go to, and who this machine is when they get there. The
 * control in the title bar owns the one that lasts an afternoon: who is in this project right now,
 * and what the live session between them is doing.
 *
 * Both read one `TeamProjectProvider`. It is not a read - it announces this window on the project
 * and subscribes to the server's topics - so two callers would announce twice and withdraw once.
 */
export { TeamStatusEntry } from "./TeamStatusEntry";
export { TeamPanel } from "./TeamPanel";
export {
    isTeamPresenceReachable,
    openTeamPresence,
    registerTeamPresenceBridge,
    type TeamPresenceBridge,
} from "./teamPresenceController";
export { LiveSessionPresence } from "./LiveSessionPresence";
export { LiveSessionDialog } from "./LiveSessionDialog";
export { TeamProjectProvider, useTeamProjectSurface } from "./TeamProjectContext";
export { useJoinableRoom, useLiveSession, useLiveSessionStories } from "./useLiveSession";
