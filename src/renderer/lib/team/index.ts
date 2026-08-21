/**
 * A Team server, as every screen that talks to one sees it.
 *
 * The version-control side of a server is `lib/vcs/servers` - the list a person picks
 * from, what a server is called, whether it is signed in to. This is the other half: what
 * that server can be asked and what it says without being asked.
 *
 * Everything here goes through one session per server, held in the main process. A screen
 * never sees a token, never opens a socket, and never polls: it calls, it subscribes, and
 * it is told.
 */
export {
    createThread,
    deleteComment,
    editComment,
    getThread,
    listMembers,
    listProjects,
    listThreads,
    readThread,
    replyToThread,
    resolveThread,
    teamCall,
    type TeamOutcome,
    type ThreadPage,
} from "./teamCall";
export { useTeamCapability, useTeamConnection, useTeamTopics } from "./useTeam";
