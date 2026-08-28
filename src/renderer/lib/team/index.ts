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
    announceClient,
    closeLiveSession,
    createThread,
    deleteComment,
    dropOverlay,
    editComment,
    findLiveSessionByCode,
    forgetProject,
    getProject,
    getThread,
    joinLiveSession,
    leaveLiveSession,
    listClients,
    listLiveSessions,
    listMembers,
    listOverlay,
    listProjectHistory,
    listProjects,
    listThreads,
    openLiveSession,
    overlayIsStale,
    putOverlay,
    readClientInstance,
    readLiveMessage,
    readLiveSession,
    readOverlayRecord,
    readThread,
    replyToThread,
    resolveThread,
    sayInLiveSession,
    teamCall,
    withdrawClient,
    type OverlayReading,
    type TeamAck,
    type TeamOutcome,
    type ThreadPage,
    type ThreadWithComments,
} from "./teamCall";
export {
    refuseLiveSessionEntry,
    type LiveSessionEntryRefusal,
    type LiveSessionRefusalKey,
} from "./liveSessionEntry";
export { useTeamCapability, useTeamConnection, useTeamTopics } from "./useTeam";
