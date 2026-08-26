/**
 * Every session Studio holds, and the one way a window reaches one.
 *
 * **This is where Team stops being a corner of version control and becomes a thing of its
 * own.** A server used to be reached through `VcsManager`, because the only reason to
 * reach one was a repository. Everything a Team server can now be asked - what is on it,
 * who is on it, what people have said about a line of a story - has nothing to do with a
 * repository, and putting it there would be the same mistake one level up: the concept
 * would live wherever it was first needed rather than where it belongs.
 *
 * What is here and nowhere else:
 *
 *  - **One client per server**, made when something first asks for that server rather
 *    than at startup. Studio may know about a dozen servers and be looking at one.
 *  - **The token**, read out of the sealed store and never handed across IPC. A window
 *    asks this to make a call; it does not get a token to make one with.
 *  - **Who asked for what.** A topic is subscribed once on the socket however many
 *    windows want it, and dropped when the last one stops - including when the last one
 *    was closed rather than tidy about it.
 *  - **The fan-out.** An event arrives once and reaches every window that asked for that
 *    topic, and none of the others.
 *
 * Nothing here decides what an event means. A payload is carried to the renderer as it
 * arrived, because the shapes belong to the protocol and the screens that read them.
 */
import type { AppWindow } from "../window/appWindow";
import type { BaseApp } from "../../baseApp";
import { IPCEventType } from "@shared/types/ipcEvents";
import type { VcsServerSession } from "@shared/types/vcs";
import type {
    TeamCallOutcome,
    TeamConnection,
    TeamSubscribeOutcome,
} from "@shared/types/team";
import type { TeamTransferOutcome, TeamTransferRequest } from "@shared/types/teamTransfer";

import { recallServerToken } from "../vcs/serverTokens";
import { installationId, machineLabel, studioAgent } from "./clientInstance";
import { TeamClient, type TeamClientOptions } from "./TeamClient";
import { TeamTransfers } from "./TeamTransfers";

/**
 * What this needs of a client, which is what a test stands in for.
 *
 * Named rather than reaching for the class, because the sessions themselves are covered
 * by their own suite: what is worth driving here is who is told what, and a stand-in that
 * records is a better way to see that than a real client with a real socket.
 */
export type TeamClientLike = Pick<
    TeamClient,
    "call" | "connect" | "connection" | "dispose" | "subscribe" | "unsubscribe"
>;

/** The two things a test supplies and nothing in the product does. */
export interface TeamStandIns {
    /** The sealed token for one server. A test has no keyring and no business having one. */
    tokenFor?: (remoteOrigin: string) => string | null;
    newClient?: (options: TeamClientOptions) => TeamClientLike;
}

/** What one window has asked to be told about, keyed by the server it is on. */
interface Subscription {
    remoteOrigin: string;
    topic: string;
}

function keyOf(subscription: Subscription): string {
    // A newline cannot occur in either half - an origin is a URL and a topic is matched
    // literally by the server - so this cannot be made to collide by naming a topic
    // cleverly.
    return `${subscription.remoteOrigin}\n${subscription.topic}`;
}

export class TeamManager {
    private readonly clients = new Map<string, TeamClientLike>();

    /** For each server and topic, the windows that asked. Keyed by `webContents` id. */
    private readonly wanted = new Map<string, Set<number>>();

    private readonly app: BaseApp;
    /** Where the addresses come from: the sessions Studio already keeps per machine. */
    private readonly servers: () => VcsServerSession[];
    private readonly tokenFor: (remoteOrigin: string) => string | null;
    private readonly newClient: (options: TeamClientOptions) => TeamClientLike;
    /**
     * Files on the move.
     *
     * One for the whole application rather than one per window, for the same reason the clients
     * are: a transfer belongs to a project on this disk, it outlives the window that started it,
     * and two windows on one project must not carry the same file twice.
     */
    private readonly files: TeamTransfers;

    constructor(app: BaseApp, servers: () => VcsServerSession[], stands: TeamStandIns = {}) {
        this.app = app;
        this.servers = servers;
        this.tokenFor = stands.tokenFor
            ?? ((remoteOrigin) => recallServerToken(app.getGlobalState(), remoteOrigin));
        this.newClient = stands.newClient ?? ((options) => new TeamClient(options));
        this.files = new TeamTransfers({
            authUrlFor: (remoteOrigin) =>
                this.servers().find((each) => each.remoteOrigin === remoteOrigin)?.authUrl ?? null,
            tokenFor: (remoteOrigin) => this.tokenFor(remoteOrigin),
            installation: () => installationId(this.app.getGlobalState()),
            userDataDir: () => this.app.getUserDataDir(),
            log: (line) => this.app.logger.info(line),
            slow: () => this.app.hasExperimentalCondition("slow-live-transfer"),
        });
        this.app.windowManager.events.on("window-closed", (window) => {
            this.forgetWindow(window);
        });
    }

    /**
     * Move a file, or say how far one has got.
     *
     * Separate from {@link call} because it is separate in kind: a call is a named method with JSON
     * on either side, and this is a stream that runs for minutes. See `@shared/types/teamTransfer`.
     */
    transfer(request: TeamTransferRequest): Promise<TeamTransferOutcome> {
        return this.files.handle(request);
    }

    /* ------------------------------------------------------------ what a screen sees */

    /** Where one server stands, without opening anything. */
    connection(remoteOrigin: string): TeamConnection {
        const client = this.clients.get(remoteOrigin);
        if (client !== undefined) return client.connection();
        return { remoteOrigin, state: "idle", capabilities: [], since: Date.now() };
    }

    /** Where every server Studio knows about stands. */
    connections(): TeamConnection[] {
        return this.servers().map((server) => this.connection(server.remoteOrigin));
    }

    /**
     * Open a session with one server, if there is one to open.
     *
     * Answers with where it stands rather than waiting for it to be ready: a screen draws
     * "connecting" and is told again when that changes, which is what the pushed status
     * is for.
     */
    open(remoteOrigin: string): TeamConnection {
        const client = this.clientFor(remoteOrigin);
        if (client === null) {
            // **Not `idle`.** Something asked and there will be no session: Studio has no
            // record of that server, or cannot read the token it sealed. Neither reaches
            // a socket, so there is no transport sentence and no amount of waiting that
            // helps - and a screen left on "connecting" would wait for ever. The reason
            // is carried as a problem rather than as prose because the two have different
            // remedies and a screen has to say which.
            const problem = this.whyNot(remoteOrigin);
            return {
                remoteOrigin,
                state: "offline",
                capabilities: [],
                problem,
                detail: problem.kind === "no-token"
                    ? "this installation cannot read its token for that server"
                    : "Studio has no record of that server",
                since: Date.now(),
            };
        }
        client.connect();
        return client.connection();
    }

    /* ------------------------------------------------------------------- talking */

    async call(remoteOrigin: string, method: string, params?: unknown): Promise<TeamCallOutcome> {
        const client = this.clientFor(remoteOrigin);
        if (client === null) return { ok: false, problem: this.whyNot(remoteOrigin) };
        return await client.call(method, params);
    }

    async subscribe(
        window: AppWindow,
        remoteOrigin: string,
        topic: string,
    ): Promise<TeamSubscribeOutcome> {
        const client = this.clientFor(remoteOrigin);
        if (client === null) return { ok: false, problem: this.whyNot(remoteOrigin) };

        const key = keyOf({ remoteOrigin, topic });
        const holders = this.wanted.get(key) ?? new Set<number>();
        holders.add(window.getWebContents().id);
        this.wanted.set(key, holders);

        const outcome = await client.subscribe(topic);
        if (!outcome.ok) {
            // The record goes back the way it was: a topic nobody is subscribed to must
            // not be re-asked for on the next reconnect.
            this.drop(key, window.getWebContents().id);
        }
        return outcome;
    }

    async unsubscribe(window: AppWindow, remoteOrigin: string, topic: string): Promise<void> {
        this.drop(keyOf({ remoteOrigin, topic }), window.getWebContents().id);
        const client = this.clients.get(remoteOrigin);
        if (client === undefined) return;
        if (this.wanted.has(keyOf({ remoteOrigin, topic }))) return;
        await client.unsubscribe(topic);
    }

    /**
     * Let a server go, because Studio was told to forget it.
     *
     * Called from wherever a server is removed. The session closes rather than being left
     * to fail on its next call, and every window's interest in it goes with it.
     */
    forget(remoteOrigin: string): void {
        this.clients.get(remoteOrigin)?.dispose();
        this.clients.delete(remoteOrigin);
        for (const key of [...this.wanted.keys()]) {
            if (key.startsWith(`${remoteOrigin}\n`)) this.wanted.delete(key);
        }
    }

    /** Close everything, because Studio is quitting. */
    dispose(): void {
        for (const client of this.clients.values()) client.dispose();
        this.clients.clear();
        this.wanted.clear();
        // The transfers stop, and their journal stays: what was interrupted is picked up when a
        // window next opens the project it belongs to.
        this.files.dispose();
    }

    /* ----------------------------------------------------------------- internals */

    /**
     * The client for one server, or null because there cannot be one.
     *
     * Null covers two different things and {@link whyNot} tells them apart: Studio has no
     * record of that server at all, or it has one and cannot read the token. Both are
     * answers a screen shows differently, and neither is a failure to report as an error.
     */
    private clientFor(remoteOrigin: string): TeamClientLike | null {
        const existing = this.clients.get(remoteOrigin);
        if (existing !== undefined) return existing;

        const server = this.servers().find((each) => each.remoteOrigin === remoteOrigin);
        if (server === undefined) return null;
        const token = this.tokenFor(remoteOrigin);
        if (token === null) return null;

        const state = this.app.getGlobalState();
        const client = this.newClient({
            remoteOrigin,
            authUrl: server.authUrl,
            token,
            // Read here rather than held on this manager, so that a label somebody
            // changed in Settings reaches the next server they connect to rather than the
            // next time Studio starts. The id is minted on the first read and kept.
            identity: {
                installation: installationId(state),
                label: machineLabel(state),
                agent: studioAgent(this.app.getAppInfo().version),
            },
            userDataDir: this.app.getUserDataDir(),
            log: (line) => this.app.logger.info(line),
            onEvent: (event) => this.deliver(remoteOrigin, event),
            onStatus: (connection) => this.announce(connection),
        });
        this.clients.set(remoteOrigin, client);
        return client;
    }

    private whyNot(remoteOrigin: string): Extract<TeamCallOutcome, { ok: false }>["problem"] {
        const known = this.servers().some((each) => each.remoteOrigin === remoteOrigin);
        return known ? { kind: "no-token" } : { kind: "no-server" };
    }

    private drop(key: string, windowId: number): void {
        const holders = this.wanted.get(key);
        if (holders === undefined) return;
        holders.delete(windowId);
        if (holders.size === 0) this.wanted.delete(key);
    }

    /**
     * A window has gone, so what it asked for goes too.
     *
     * Without this a closed window's topics would be re-subscribed on every reconnect for
     * as long as Studio runs, and its events would be sent to a `webContents` that is not
     * there. Neither is expensive; both are the kind of thing that is never noticed and
     * never stops.
     */
    private forgetWindow(window: AppWindow): void {
        let windowId: number;
        try {
            windowId = window.getWebContents().id;
        } catch {
            // A window destroyed before this ran has no webContents to name. There is
            // nothing to key on, and the delivery path drops what it cannot send to.
            return;
        }
        for (const [key, holders] of [...this.wanted]) {
            if (!holders.delete(windowId) || holders.size > 0) continue;
            this.wanted.delete(key);
            const separator = key.indexOf("\n");
            const remoteOrigin = key.slice(0, separator);
            void this.clients.get(remoteOrigin)?.unsubscribe(key.slice(separator + 1));
        }
    }

    private deliver(
        remoteOrigin: string,
        event: { topic: string; seq: number; payload: unknown },
    ): void {
        const holders = this.wanted.get(keyOf({ remoteOrigin, topic: event.topic }));
        if (holders === undefined) return;
        for (const window of this.app.windowManager.getWindows()) {
            if (window.isClosed() || window.isDestroyed()) continue;
            if (!holders.has(window.getWebContents().id)) continue;
            try {
                window.sendIpcEvent(IPCEventType.teamEvent, { remoteOrigin, ...event });
            } catch (error) {
                this.app.logger.debug(`[Team] Could not deliver an event: ${String(error)}`);
            }
        }
    }

    /**
     * Say where a server stands, to every window.
     *
     * Not only to the windows holding a topic on it: the state of a connection is drawn
     * beside a server wherever one is listed, and a window that is showing the list has
     * not subscribed to anything.
     */
    private announce(connection: TeamConnection): void {
        for (const window of this.app.windowManager.getWindows()) {
            if (window.isClosed() || window.isDestroyed()) continue;
            try {
                window.sendIpcEvent(IPCEventType.teamConnectionChanged, { connection });
            } catch (error) {
                this.app.logger.debug(`[Team] Could not announce a connection: ${String(error)}`);
            }
        }
    }
}
