/**
 * One server, as a session that is kept open.
 *
 * Everything Studio asks a Team server goes through one of these. What it adds over the
 * socket underneath is the four things a connection that is expected to outlive any one
 * question needs:
 *
 *  - **Calls that are answered by id**, so several can be in flight and each lands where
 *    it was asked from.
 *  - **Subscriptions that survive a reconnect.** The topics a screen asked for are kept
 *    here, and asked for again the moment a new session opens. A screen does not know
 *    that the connection dropped and should not have to.
 *  - **Backoff**, so a server that is down costs one attempt a minute rather than a tight
 *    loop, and **no backoff at all after a refusal**: a token the server will not have is
 *    not a token that works if it is presented faster.
 *  - **A state a screen can draw**, because "connecting" and "the token expired" are
 *    different things to be told.
 *
 * **Reconnecting is not resuming.** Nothing is replayed and nothing is queued: a call
 * made while the socket is down waits briefly for one and is otherwise refused as
 * offline, and a subscription that comes back is told where the topic's sequence stands
 * rather than what it missed. What recovers a missed event is reading the collection
 * again, which is what a screen does when this reports `ready` - see the renderer's
 * `useTeamTopic`. That is the weakest guarantee that is still correct, and it is the one
 * that needs no durable outbox on either side.
 */
import {
    TEAM_PROTOCOL_VERSION,
    TEAM_SOCKET_PATH,
    type TeamCallOutcome,
    type TeamCapability,
    type TeamConnection,
    type TeamHelloFrame,
    type TeamServerFrame,
    type TeamSubscribeOutcome,
} from "@shared/types/team";

import { TeamSocket, type TeamSocketClosed, type TeamSocketOptions } from "./socket";

/** How long a call waits for an answer before the session is treated as hung. */
const CALL_TIMEOUT_MS = 20_000;

/** How long a call made while the socket is down waits for one to open. */
const CONNECT_WAIT_MS = 12_000;

/** The first backoff, and the ceiling it doubles towards. */
const BACKOFF_FIRST_MS = 1_000;
const BACKOFF_LIMIT_MS = 60_000;

/** What the server is told to expect if its opening frame does not say. */
const DEFAULT_HEARTBEAT_MS = 30_000;

export interface TeamClientOptions {
    /** The server's data origin, which is how Studio names a server everywhere else. */
    remoteOrigin: string;
    /** Where the session is opened, e.g. `https://team.example.lan:41402`. */
    authUrl: string;
    token: string;
    userDataDir: string;
    log?: (line: string) => void;
    onEvent: (event: { topic: string; seq: number; payload: unknown }) => void;
    onStatus: (connection: TeamConnection) => void;
    /**
     * How a socket is opened, for a test that has no server to open one to.
     *
     * The seam is here rather than around the whole client because what a test needs to
     * drive is exactly this: frames in, frames out, and a close it decides when. Defaults
     * to the real one, so nothing in the product passes it.
     */
    openSocket?: (options: TeamSocketOptions) => TeamSocketLike;
}

/** What the client needs of a socket. {@link TeamSocket} is the one that does it. */
export interface TeamSocketLike {
    send: (text: string) => void;
    close: (detail?: string) => void;
    readonly closed: boolean;
}

interface Waiting {
    settle: (outcome: TeamCallOutcome | TeamSubscribeOutcome) => void;
    timer: NodeJS.Timeout;
    /** True for a subscribe, whose success carries a sequence rather than a value. */
    subscription: boolean;
}

export class TeamClient {
    private readonly options: TeamClientOptions;
    private socket: TeamSocketLike | null = null;
    private hello: TeamHelloFrame | null = null;

    private state: TeamConnection["state"] = "idle";
    private detail: string | undefined;
    private since = Date.now();

    private nextId = 1;
    private readonly waiting = new Map<number, Waiting>();

    /** The topics a screen has asked for, which is what a new session re-subscribes to. */
    private readonly topics = new Set<string>();

    private backoff = BACKOFF_FIRST_MS;
    private retry: NodeJS.Timeout | undefined;
    /** Set when reconnecting would be pointless: the server refused this token. */
    private stopped = false;
    private disposed = false;

    /** Whoever is waiting for a session to open, so several calls share one attempt. */
    private opening: ((ready: boolean) => void)[] = [];

    constructor(options: TeamClientOptions) {
        this.options = options;
    }

    /* ------------------------------------------------------------ what it is */

    get remoteOrigin(): string {
        return this.options.remoteOrigin;
    }

    /** Whether the server offered something. False while there is no session. */
    can(capability: TeamCapability): boolean {
        return this.hello?.capabilities.includes(capability) === true;
    }

    /** Whether the server has a method by that name, which is the finer check. */
    has(method: string): boolean {
        return this.hello?.methods.includes(method) === true;
    }

    connection(): TeamConnection {
        return {
            remoteOrigin: this.options.remoteOrigin,
            state: this.state,
            capabilities: this.hello?.capabilities ?? [],
            ...(this.hello === null ? {} : { account: this.hello.account }),
            ...(this.hello === null ? {} : { serverName: this.hello.server.name }),
            ...(this.hello === null ? {} : { serverVersion: this.hello.server.version }),
            ...(this.detail === undefined ? {} : { detail: this.detail }),
            since: this.since,
        };
    }

    /* ------------------------------------------------------------ connecting */

    /**
     * Open a session, unless one is open or on its way.
     *
     * Called by whatever needs the server rather than at startup: Studio knows about
     * every server it has been added to and holds a session with the one a screen is
     * showing. A connection per known server would be a connection per server that is
     * switched off.
     */
    connect(): void {
        if (this.disposed || this.socket !== null) return;
        this.stopped = false;
        this.open();
    }

    private open(): void {
        const endpoint = endpointOf(this.options.authUrl);
        if (endpoint === null) {
            this.moveTo("offline", `${this.options.authUrl} is not an address this understands`);
            return;
        }
        this.moveTo("connecting", undefined);
        const openSocket = this.options.openSocket ?? TeamSocket.open;
        this.socket = openSocket({
            host: endpoint.host,
            port: endpoint.port,
            path: TEAM_SOCKET_PATH,
            token: this.options.token,
            userDataDir: this.options.userDataDir,
            heartbeatMs: this.hello?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
            handlers: {
                onOpen: () => {
                    // Nothing is said until the server has: the opening frame is what
                    // says which protocol and which methods, and asking before it would
                    // be asking on a guess.
                },
                onMessage: (text) => this.receive(text),
                onClose: (closed) => this.dropped(closed),
            },
        });
    }

    private dropped(closed: TeamSocketClosed): void {
        this.socket = null;
        // **What the server said it serves is kept.** A dropped socket does not un-say
        // it: the capabilities describe the deployment, and the state describes the
        // connection. Clearing them made every screen drawn from a capability vanish the
        // moment a server restarted, which reads as "this server never offered that"
        // rather than "it is not answering just now" - measured on a real one, and it
        // took the whole conversations section off the page. A new opening frame replaces
        // this, so a server that really has changed corrects itself on reconnect.

        // Every call still waiting was asked of a session that no longer exists. Failing
        // them now is what stops a screen spinning until its own timeout.
        for (const [id, call] of [...this.waiting]) {
            clearTimeout(call.timer);
            this.waiting.delete(id);
            call.settle({ ok: false, problem: { kind: "offline", detail: closed.detail } });
        }
        this.wake(false);

        // A refusal is final until somebody does something about it. Retrying a token the
        // server has already declined is a request a minute that will never work, and it
        // hides the one thing the author has to be told.
        if (closed.status === 401 || this.stopped) {
            this.stopped = true;
            this.moveTo("offline", closed.detail);
            return;
        }
        this.moveTo("offline", closed.detail);
        if (this.disposed) return;

        this.retry = setTimeout(() => {
            this.retry = undefined;
            if (!this.disposed && !this.stopped) this.open();
        }, this.backoff);
        this.retry.unref?.();
        this.backoff = Math.min(this.backoff * 2, BACKOFF_LIMIT_MS);
    }

    /* --------------------------------------------------------------- talking */

    /** Ask the server something. */
    async call(method: string, params?: unknown): Promise<TeamCallOutcome> {
        const ready = await this.ready();
        if (!ready.ok) return ready;
        if (!this.has(method)) {
            // Checked rather than attempted, which is the same bargain the capability
            // list is: a deployment that does not do this is not a failure to report, it
            // is a screen that is not drawn.
            return { ok: false, problem: { kind: "unsupported" } };
        }
        return (await this.ask({ t: "call", method, params }, false)) as TeamCallOutcome;
    }

    /** Ask to be told about a topic, and keep asking after every reconnect. */
    async subscribe(topic: string): Promise<TeamSubscribeOutcome> {
        this.topics.add(topic);
        const ready = await this.ready();
        if (!ready.ok) return ready;
        return (await this.ask({ t: "subscribe", topic }, true)) as TeamSubscribeOutcome;
    }

    /** Stop being told, and stop asking for it after a reconnect. */
    async unsubscribe(topic: string): Promise<void> {
        this.topics.delete(topic);
        if (this.state !== "ready") return;
        await this.ask({ t: "unsubscribe", topic }, false);
    }

    /** Close the session and let go of everything, because the server was forgotten. */
    dispose(): void {
        this.disposed = true;
        this.topics.clear();
        if (this.retry !== undefined) {
            clearTimeout(this.retry);
            this.retry = undefined;
        }
        this.socket?.close("Studio let this server go");
        this.socket = null;
        this.hello = null;
        this.moveTo("idle", undefined);
    }

    /* ------------------------------------------------------------- internals */

    /**
     * A session, or the reason there will not be one in time.
     *
     * A call made a moment after Studio started is ordinary - the session is opening -
     * and waiting briefly is what makes a screen that asks straight away work. Waiting
     * indefinitely is not: a server that is switched off would leave every screen
     * spinning rather than saying so.
     */
    private async ready(): Promise<{ ok: true } | { ok: false; problem: TeamProblemOf }> {
        if (this.state === "ready") return { ok: true };
        if (this.stopped) {
            return { ok: false, problem: { kind: "offline", detail: this.detail ?? "refused" } };
        }
        this.connect();
        const opened = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
                this.opening = this.opening.filter((waiter) => waiter !== settle);
                resolve(false);
            }, CONNECT_WAIT_MS);
            const settle = (value: boolean): void => {
                clearTimeout(timer);
                resolve(value);
            };
            this.opening.push(settle);
        });
        if (opened) return { ok: true };
        return {
            ok: false,
            problem: { kind: "offline", detail: this.detail ?? "no session with that server" },
        };
    }

    private ask(
        frame: { t: "call" | "subscribe" | "unsubscribe"; method?: string; params?: unknown; topic?: string },
        subscription: boolean,
    ): Promise<TeamCallOutcome | TeamSubscribeOutcome> {
        const socket = this.socket;
        if (socket === null) {
            return Promise.resolve({
                ok: false as const,
                problem: { kind: "offline" as const, detail: "no session with that server" },
            });
        }
        const id = this.nextId++;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.waiting.delete(id);
                // A session that does not answer is a session that is not working, and
                // the next call must not queue behind the same silence. Dropping it puts
                // the reconnect machinery in charge.
                this.options.log?.(`[Team] ${this.options.remoteOrigin} did not answer a call`);
                socket.close("that server did not answer");
                resolve({ ok: false, problem: { kind: "offline", detail: "that server did not answer" } });
            }, CALL_TIMEOUT_MS);
            timer.unref?.();
            this.waiting.set(id, { settle: resolve, timer, subscription });
            socket.send(JSON.stringify({ ...frame, id }));
        });
    }

    private receive(text: string): void {
        let frame: TeamServerFrame;
        try {
            frame = JSON.parse(text) as TeamServerFrame;
        } catch {
            this.options.log?.(`[Team] ${this.options.remoteOrigin} sent something that was not JSON`);
            return;
        }

        switch (frame.t) {
            case "hello":
                this.opened(frame);
                return;
            case "event":
                this.options.onEvent({ topic: frame.topic, seq: frame.seq, payload: frame.payload });
                return;
            case "bye":
                // The socket closes on its own heels; what this carries that the close
                // does not is why. `unauthenticated` is the one worth keeping, because it
                // is the one reconnecting cannot fix.
                this.detail = frame.message;
                if (frame.code === "unauthenticated") this.stopped = true;
                return;
            case "result":
            case "error":
            case "subscribed":
                this.answer(frame);
                return;
            default:
                this.options.log?.(`[Team] ${this.options.remoteOrigin} sent a frame this does not read`);
        }
    }

    private opened(frame: TeamHelloFrame): void {
        if (frame.protocol !== TEAM_PROTOCOL_VERSION) {
            // Not a reconnect: a protocol number that moved means a field this build
            // relies on stopped meaning what it meant, and trying again would be trying
            // the same misunderstanding.
            this.stopped = true;
            this.socket?.close("that server speaks a version of the protocol this build does not");
            this.moveTo(
                "offline",
                `that server speaks protocol ${frame.protocol} and this build speaks ${TEAM_PROTOCOL_VERSION}`,
            );
            return;
        }
        this.hello = frame;
        this.backoff = BACKOFF_FIRST_MS;
        this.moveTo("ready", undefined);
        this.wake(true);
        this.options.log?.(
            `[Team] Session with ${this.options.remoteOrigin} as ${frame.account.username}`,
        );

        // Asked for again rather than remembered by the server: a session is new, and
        // what the last one was told is not something this one knows.
        for (const topic of this.topics) {
            void this.ask({ t: "subscribe", topic }, true);
        }
    }

    private answer(frame: TeamServerFrame & { id: number }): void {
        const call = this.waiting.get(frame.id);
        if (call === undefined) return;
        clearTimeout(call.timer);
        this.waiting.delete(frame.id);

        if (frame.t === "error") {
            call.settle({
                ok: false,
                problem: { kind: "refused", code: frame.code, detail: frame.message },
            });
            return;
        }
        if (frame.t === "subscribed") {
            call.settle({ ok: true, seq: frame.seq });
            return;
        }
        if (call.subscription) {
            // A subscribe that was answered with a plain result is a server that did not
            // understand it as one. Reported rather than silently taken as success.
            call.settle({ ok: false, problem: { kind: "refused", code: "internal", detail: "that server did not answer the subscription" } });
            return;
        }
        call.settle({ ok: true, value: (frame as { value: unknown }).value });
    }

    /** Let go of everybody waiting for a session, saying whether they got one. */
    private wake(ready: boolean): void {
        const waiters = this.opening;
        this.opening = [];
        for (const waiter of waiters) waiter(ready);
    }

    private moveTo(state: TeamConnection["state"], detail: string | undefined): void {
        if (this.state === state && this.detail === detail) return;
        this.state = state;
        this.detail = detail;
        this.since = Date.now();
        this.options.onStatus(this.connection());
    }
}

/** The problem shape this hands back, named so the two returns above share it. */
type TeamProblemOf = Extract<TeamCallOutcome, { ok: false }>["problem"];

/**
 * The host and port behind a stored `authUrl`.
 *
 * Sessions keep `https://host:port`. Parsed rather than pattern-matched so that a
 * trailing slash, a stray path or an IPv6 literal are the URL parser's problem.
 */
export function endpointOf(authUrl: string): { host: string; port: number } | null {
    try {
        const url = new URL(authUrl);
        if (url.protocol !== "https:") return null;
        const port = url.port === "" ? 443 : Number(url.port);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
        return { host: url.hostname, port };
    } catch {
        return null;
    }
}
