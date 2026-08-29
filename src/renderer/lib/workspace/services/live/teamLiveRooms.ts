import { getInterface } from "@/lib/app/bridge";
import {
    answerLiveSessionJoin,
    closeLiveSession,
    findLiveSessionByCode,
    joinLiveSession,
    joinLiveSessionByCode,
    leaveLiveSession,
    listLiveSessions,
    openLiveSession,
    readLiveMessage,
    readLiveSession,
    requestLiveSessionJoin,
    sayInLiveSession,
    setLiveSessionRule,
} from "@/lib/team/teamCall";
import {
    teamLiveTopic,
    teamProjectLiveTopic,
    type TeamLiveEvent,
    type TeamLiveMember,
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
        joinByCode: code => joinLiveSessionByCode(remoteOrigin, code),
        byCode: code => findLiveSessionByCode(remoteOrigin, code),
        rule: (sessionId, rule) => setLiveSessionRule(remoteOrigin, sessionId, rule),
        requestJoin: sessionId => requestLiveSessionJoin(remoteOrigin, sessionId),
        answerJoin: (sessionId, instance, admit) =>
            answerLiveSessionJoin(remoteOrigin, sessionId, instance, admit),
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
    if (kind === "live-requested") {
        // ⚠ A room id where the two above carry the room, because whoever asked is not in it
        // and the server has nothing else to say about a room they are outside of.
        const session = (payload as { session?: unknown }).session;
        const member = readLiveMember((payload as { member?: unknown }).member);
        return typeof session === "string" && session !== "" && member !== null
            ? { kind, session, member }
            : null;
    }
    if (kind === "live-refused") {
        const session = (payload as { session?: unknown }).session;
        const instance = (payload as { instance?: unknown }).instance;
        return typeof session === "string" && session !== ""
            && typeof instance === "string" && instance !== ""
            ? { kind, session, instance }
            : null;
    }
    return null;
}

/**
 * One person on a room's roster, as an event carries them.
 *
 * Read rather than trusted, for the reason the room itself is: this crossed a network from a
 * build that may be newer, and a half-read member would put a nameless request in front of an
 * author who has to decide about somebody.
 */
function readLiveMember(value: unknown): TeamLiveMember | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const { instance, account, label, joinedAt } = value as Record<string, unknown>;
    if (typeof instance !== "string" || instance === "") return null;
    if (typeof account !== "string" || account === "") return null;
    return {
        instance,
        account,
        label: typeof label === "string" ? label : "",
        joinedAt: typeof joinedAt === "number" ? joinedAt : 0,
    };
}
