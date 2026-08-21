/**
 * This project's server, as a live source rather than an address on disk.
 *
 * **What changed, and why it needed changing.** Everything the workspace knew about its
 * server was read from disk: the remote address out of the repository's config, the
 * account out of the machine's session list. Both are local, both are instant, and
 * neither is a fact about the server - a project can point at a host that is switched
 * off, at a server that no longer holds it, or at an account whose token was revoked
 * last week, and every one of those reads on screen as a working connection until
 * somebody presses Send and is refused. The only thing that ever contacted the server was
 * a row somebody pressed, called "Check".
 *
 * So the server is a source now. Opening a project opens a session with it, and from then
 * on four things are true continuously rather than when asked:
 *
 *  1. **Is it answering, and does it still know this account?** The session's own state,
 *     which the main process keeps and pushes.
 *  2. **Does it hold this project?** Matched on the repository id - the only identity that
 *     survives a rename - against the list the server serves. A project whose folder was
 *     copied, or whose server had it taken off, says so instead of failing at Send.
 *  3. **Who else has it open?** Presence, which is what a room is opened out of.
 *  4. **What is attached to it that is not in it?** The overlay, pulled with the head the
 *     server last read, so that a record about an old revision can be told from one about
 *     this one.
 *
 * **Nothing here is a poll.** One read happens when the session becomes ready, and after
 * that the server says when to read again: `project:{id}` when it has re-read the
 * repository, `/overlay` when a record moved, `/clients` when somebody arrived or left,
 * `/live` when a room opened or closed. That is the whole freshness story, and it is the
 * same one `useTeamTopics` already tells - an event says the collection moved, and the
 * collection is read rather than patched.
 *
 * ⚠ **A failed read never replaces what was read last.** A server that stopped answering
 * has not deleted anything, and drawing an empty list would turn "could not ask" into
 * "nobody has said anything". Same rule, same reason, as the discussion list that was
 * measured doing exactly that on a real server.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    announceClient,
    listClients,
    listLiveSessions,
    listOverlay,
    listProjects,
    useTeamCapability,
    useTeamConnection,
    withdrawClient,
    type OverlayReading,
    type TeamOutcome,
} from "@/lib/team";
import { getInterface } from "@/lib/app/bridge";
import {
    teamProjectClientsTopic,
    teamProjectLiveTopic,
    teamProjectOverlayTopic,
    teamProjectTopic,
    type TeamClientInstance,
    type TeamLiveSession,
} from "@shared/types/team";
import { parseVcsRemoteUrl, type VcsServerProject } from "@shared/types/vcs";

/**
 * What the workspace knows about its server right now.
 *
 * Six answers rather than a boolean, because each of them is a different sentence and a
 * different next act. The two that did not exist before this file are `not-there` and
 * `verified`: until now "the address is written down" was the whole of what could be
 * said.
 */
export type TeamProjectState =
    /** This project points at no server. */
    | { kind: "none" }
    /** It points at one, but this machine cannot open a session - no record, or no token. */
    | { kind: "no-account" }
    /** A session is being opened. The first state every connected project passes through. */
    | { kind: "connecting" }
    /** Not answering. The detail is the transport's own sentence, for a log rather than a screen. */
    | { kind: "unreachable"; detail?: string }
    /**
     * Answering, and it does not hold this project.
     *
     * A real state and a common one: a folder copied from a colleague carries their
     * remote address, and a project taken off a server keeps pointing at it. Until this
     * existed, both read as connected right up until Send was refused.
     */
    | { kind: "not-there" }
    /** Answering, and this is the project it holds. */
    | { kind: "verified"; project: VcsServerProject };

export interface TeamProjectSurface {
    /** Where the project stands with its server. */
    state: TeamProjectState;
    /** The server's data origin, or null where there is none to talk to. */
    remoteOrigin: string | null;
    /**
     * What the server last read this project's tip to be, absent because it has not.
     *
     * ⚠ Absent is "not read yet", never "no revisions". Nothing may compare against this
     * without checking it is there - see `overlayIsStale`.
     */
    head?: string;
    /** Which installations have this project open, this window included. */
    clients: TeamClientInstance[];
    /**
     * What this window is called on that server, absent until the announcement lands.
     *
     * Composed in the main process out of this installation's id and the project's, and
     * learnt here from the answer rather than worked out - a renderer that could compose
     * an instance id could compose somebody else's. It is what tells this window's own
     * row in a room from anybody else's.
     */
    instance?: string;
    /** The rooms open on this project. */
    live: TeamLiveSession[];
    /** What is attached to this project without being in it. */
    overlay: OverlayReading | null;
    /** Whether the server offers rooms at all, so a control for one is drawn or is not. */
    canLive: boolean;
    /** Whether it offers attached data. */
    canOverlay: boolean;
    /** Whether it says who is connected. */
    canSeeClients: boolean;
    /** Read everything again now, for something that changed the answer from this side. */
    refresh: () => void;
}

const NOTHING: TeamProjectSurface = {
    state: { kind: "none" },
    remoteOrigin: null,
    clients: [],
    live: [],
    overlay: null,
    canLive: false,
    canOverlay: false,
    canSeeClients: false,
    refresh: () => undefined,
};

/**
 * Follow this project's server.
 *
 * `remote` and `repositoryId` come off the version surface, which reads both locally.
 * Pass nulls for a project that has neither and nothing is opened - a window with no
 * repository must not hold a session.
 */
export function useTeamProject(
    remote: string | null,
    repositoryId: string | null,
): TeamProjectSurface {
    const remoteOrigin = useMemo(
        () => (remote === null ? null : parseVcsRemoteUrl(remote)?.origin ?? null),
        [remote],
    );
    const connection = useTeamConnection(remoteOrigin);
    const canSeeClients = useTeamCapability(connection, "clients");
    const canLive = useTeamCapability(connection, "live");
    const canOverlay = useTeamCapability(connection, "overlay");
    const ready = connection.state === "ready";

    const [project, setProject] = useState<VcsServerProject | null>(null);
    /** Whether the last successful project read found this repository. Null before one. */
    const [held, setHeld] = useState<boolean | null>(null);
    const [clients, setClients] = useState<TeamClientInstance[]>([]);
    const [live, setLive] = useState<TeamLiveSession[]>([]);
    const [overlay, setOverlay] = useState<OverlayReading | null>(null);
    const [instance, setInstance] = useState<string | null>(null);
    /** Which read is the current one, so an older answer cannot land last. */
    const latest = useRef(0);

    /**
     * Read the four collections.
     *
     * One function rather than four hooks because they share a precondition - a session
     * that is ready and a project the server holds - and because every event that
     * invalidates one of them is a reason to have another look at the rest. Reading four
     * small collections costs one round trip each on a connection that is already open.
     */
    const refresh = useCallback(() => {
        if (remoteOrigin === null || repositoryId === null || !ready) return;
        const ticket = latest.current + 1;
        latest.current = ticket;

        void (async () => {
            const projects = await listProjects(remoteOrigin);
            if (ticket !== latest.current) return;
            if (!projects.ok) {
                // Left as it was. What was true a moment ago is almost certainly still
                // true, and a server that stopped answering has not taken anything away.
                return;
            }
            // Matched on the repository id rather than the name, which is the only
            // identity that survives a rename on either side.
            const mine = projects.value.find((each) => each.id === repositoryId) ?? null;
            setProject(mine);
            setHeld(mine !== null);
            if (mine === null) return;

            const keep = <T,>(answer: TeamOutcome<T>, set: (value: T) => void): void => {
                if (ticket === latest.current && answer.ok) set(answer.value);
            };
            if (canSeeClients) keep(await listClients(remoteOrigin, mine.id), setClients);
            if (canLive) keep(await listLiveSessions(remoteOrigin, mine.id), setLive);
            if (canOverlay) keep(await listOverlay(remoteOrigin, mine.id), setOverlay);
        })();
    }, [remoteOrigin, repositoryId, ready, canSeeClients, canLive, canOverlay]);

    /**
     * Say this window is here, and take it back when it is not.
     *
     * Announced on every fresh session as well as on the first, keyed on `since`: the
     * server keeps presence in memory and loses it with the socket, so a reconnect that
     * did not re-announce would be a window nobody could see. The main process replays it
     * too, and both doing it is deliberate - announcing twice is defined to be ordinary,
     * and the one that must never be missed is this one.
     */
    useEffect(() => {
        if (remoteOrigin === null || repositoryId === null || !ready || !canSeeClients) return;
        let alive = true;
        void announceClient(remoteOrigin, { project: repositoryId })
            .then((answer) => {
                if (alive && answer.ok) setInstance(answer.value.id);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
            // The window is closing, or has moved to another server. The socket may well
            // outlive it, so the presence has to be taken back by hand.
            void withdrawClient(remoteOrigin, repositoryId).catch(() => undefined);
        };
    }, [remoteOrigin, repositoryId, ready, canSeeClients, connection.since]);

    /** Every topic this project is described by, subscribed while it is on screen. */
    const topics = useMemo(() => {
        if (project === null) return [] as string[];
        const wanted = [teamProjectTopic(project.id)];
        if (canOverlay) wanted.push(teamProjectOverlayTopic(project.id));
        if (canSeeClients) wanted.push(teamProjectClientsTopic(project.id));
        if (canLive) wanted.push(teamProjectLiveTopic(project.id));
        return wanted;
    }, [project, canOverlay, canSeeClients, canLive]);

    useEffect(() => {
        if (remoteOrigin === null || !ready || topics.length === 0) return;
        let alive = true;
        for (const topic of topics) {
            void getInterface().team.subscribe(remoteOrigin, topic).catch(() => undefined);
        }
        const token = getInterface().team.onEvent((message) => {
            if (!alive) return;
            if (message.remoteOrigin !== remoteOrigin) return;
            if (!topics.includes(message.topic)) return;
            // Read again rather than apply the payload. An event says a collection moved;
            // reading it is both simpler and more correct than keeping a copy honest.
            refresh();
        });
        return () => {
            alive = false;
            token.cancel();
            for (const topic of topics) {
                void getInterface().team.unsubscribe(remoteOrigin, topic).catch(() => undefined);
            }
        };
    }, [remoteOrigin, ready, topics, refresh]);

    // Keyed on `since` as well as on readiness, so a session that dropped and came back
    // reads again. That is the whole of the reconnect recovery: nothing is ever replayed.
    useEffect(() => {
        refresh();
    }, [refresh, connection.since]);

    // A project pointed somewhere else, or at nothing, must not go on showing the last
    // server's answers.
    useEffect(() => {
        latest.current += 1;
        setProject(null);
        setHeld(null);
        setClients([]);
        setLive([]);
        setOverlay(null);
        setInstance(null);
    }, [remoteOrigin, repositoryId]);

    if (remoteOrigin === null || repositoryId === null) return NOTHING;

    const state = ((): TeamProjectState => {
        switch (connection.state) {
            case "idle":
            case "connecting":
                return { kind: "connecting" };
            case "offline":
                // "No account here" and "not answering" are two sentences with two
                // remedies, and the main process tells them apart rather than leaving it
                // to be guessed from a transport message: a project pointed at a server
                // this installation has no record of, or no readable token for, never
                // gets as far as a socket.
                if (connection.problem !== undefined) return { kind: "no-account" };
                return {
                    kind: "unreachable",
                    ...(connection.detail === undefined ? {} : { detail: connection.detail }),
                };
            case "ready":
                if (held === null) return { kind: "connecting" };
                return project === null ? { kind: "not-there" } : { kind: "verified", project };
        }
    })();

    return {
        state,
        remoteOrigin,
        ...(overlay?.head === undefined ? {} : { head: overlay.head }),
        clients,
        ...(instance === null ? {} : { instance }),
        live,
        overlay,
        canLive,
        canOverlay,
        canSeeClients,
        refresh,
    };
}
