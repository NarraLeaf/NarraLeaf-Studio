/**
 * NarraLeaf Team, as the workspace sees it.
 *
 * Two surfaces, for two questions that move at different speeds. The cell in the bottom-left corner
 * and the dialog behind it own the rare ones the version rail used to carry beside Send and Get:
 * which server this project's versions go to, and who this machine is when they get there. The
 * account in the title bar says who you are on that server and, in a team project, who else is in
 * it right now.
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
export { TeamAccountAvatar } from "./TeamAccountAvatar";
export { TeamProjectProvider, useTeamProjectSurface } from "./TeamProjectContext";
export { StoryCommentsTeamSyncMount } from "./StoryCommentsTeamSync";
export { TeamNotificationsBell } from "./TeamNotificationsBell";
export { TeamRoleNotice } from "./TeamRoleNotice";
export { TeamEditingNotice } from "./TeamEditingNotice";
