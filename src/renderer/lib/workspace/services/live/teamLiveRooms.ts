import { getInterface } from "@/lib/app/bridge";
import {
    closeLiveSession,
    joinLiveSession,
    leaveLiveSession,
    listLiveSessions,
    openLiveSession,
    readLiveMessage,
    readLiveSession,
    sayInLiveSession,
} from "@/lib/team/teamCall";
import {
    teamLiveTopic,
    teamProjectLiveTopic,
    type TeamLiveEvent,
} from "@shared/types/team";
import type { LiveRooms } from "./liveSessionPorts";

/**
 * A project's rooms on one Team server.
 *
 * The whole of what a live session knows about transport, in one place and behind a port, so that
 * everything above it - which half of the session this window is, when the workspace freezes, what
 * undoes an operation - is exercised without a socket. The server reads none of what travels this
 * way: every message is the opaque payload of one `live.say`, which is why the protocol needed no
 * addition to carry a feature it knows nothing about.
 *
 * ⚠ **Every participant receives its own messages back.** That is not a quirk to filter out here -
 * `LiveHost` and `LiveGuest` both expect it, and it is what lets a window tell a round trip it made
 * from one it did not.
 */
export function createTeamLiveRooms(remoteOrigin: string): LiveRooms {
    return {
        list: project => listLiveSessions(remoteOrigin, project),
        open: input => openLiveSession(remoteOrigin, input),
        join: sessionId => joinLiveSession(remoteOrigin, sessionId),
        leave: sessionId => leaveLiveSession(remoteOrigin, sessionId),
        close: sessionId => closeLiveSession(remoteOrigin, sessionId),
        say: (sessionId, payload) => {
            // Nothing waits for this. Whether a message arrived is not knowable - the room keeps
            // nothing and reaches whoever is listening at that instant - so the repair is the
            // guest's re-send under an idempotency key, not an answer read here.
            void sayInLiveSession(remoteOrigin, sessionId, payload);
        },
        listen: (sessionId, onMessage) => {
            const topic = teamLiveTopic(sessionId);
            void getInterface().team.subscribe(remoteOrigin, topic).catch(() => undefined);
            const token = getInterface().team.onEvent(message => {
                if (message.remoteOrigin !== remoteOrigin || message.topic !== topic) {
                    return;
                }
                const said = readLiveMessage(message.payload);
                if (said === null || said.session !== sessionId) {
                    return;
                }
                // `from` is the instance the SERVER says sent it, never something the payload claims
                // about itself: an intent carries no author for exactly that reason. The account
                // beside it is stamped by the same server on the same message, which is why a
                // claim can be recorded against a person without waiting for the roster to catch
                // up - see `LiveRooms.listen`.
                onMessage(said.payload, said.from, said.account);
            });
            return () => {
                token.cancel();
                void getInterface().team.unsubscribe(remoteOrigin, topic).catch(() => undefined);
            };
        },
        watch: (project, onEvent) => {
            const topic = teamProjectLiveTopic(project);
            void getInterface().team.subscribe(remoteOrigin, topic).catch(() => undefined);
            const token = getInterface().team.onEvent(message => {
                if (message.remoteOrigin !== remoteOrigin || message.topic !== topic) {
                    return;
                }
                const event = readRoomEvent(message.payload);
                if (event !== null) {
                    onEvent(event);
                }
            });
            return () => {
                token.cancel();
                void getInterface().team.unsubscribe(remoteOrigin, topic).catch(() => undefined);
            };
        },
    };
}

/**
 * One thing that happened to a project's rooms, or null because what arrived was not one.
 *
 * Read rather than trusted, like every other answer from a server: this crossed a network from a
 * build that may be newer than this one, and a room that half-reads must be ignored rather than
 * turned into a session ending under somebody's hands.
 */
export function readRoomEvent(payload: unknown): TeamLiveEvent | null {
    if (typeof payload !== "object" || payload === null) {
        return null;
    }
    const kind = (payload as { kind?: unknown }).kind;
    if (kind === "live-closed") {
        const session = (payload as { session?: unknown }).session;
        return typeof session === "string" && session !== "" ? { kind, session } : null;
    }
    if (kind === "live-opened" || kind === "live-changed") {
        const session = readLiveSession((payload as { session?: unknown }).session);
        return session === null ? null : { kind, session };
    }
    return null;
}
