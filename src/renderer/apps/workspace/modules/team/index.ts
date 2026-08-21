/**
 * NarraLeaf Team, as the workspace sees it.
 *
 * One cell in the bottom-left corner and one panel behind it, which between them own the two
 * questions the version rail used to carry beside its Send and Get buttons: which server this
 * project's versions go to, and who this machine is when they get there.
 */
export { TeamStatusEntry } from "./TeamStatusEntry";
export { TeamPanel } from "./TeamPanel";
export {
    isTeamPresenceReachable,
    openTeamPresence,
    registerTeamPresenceBridge,
    type TeamPresenceBridge,
} from "./teamPresenceController";
