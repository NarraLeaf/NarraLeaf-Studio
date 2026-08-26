/**
 * A session, driven without a server.
 *
 * The socket is stood in for, which is the whole point: what these are about is the part
 * of a session that is not the wire - a call answered by id, a refusal carried through
 * with its code, a reconnect that asks for its topics again, and a token the server
 * declined not being tried a second time. Every one of those is a decision made here, and
 * none of them is visible from the other side of a real connection until it goes wrong on
 * somebody's machine.
 *
 * The framing itself is not exercised here. It is symmetrical with the server's, and the
 * server's suite drives it with bytes.
 */
import { describe, expect, it, vi } from "vitest";

import type { TeamConnection } from "@shared/types/team";

import { TeamClient, endpointOf, type TeamSocketLike } from "./TeamClient";
import type { TeamSocketClosed, TeamSocketOptions } from "./socket";

/** A socket a test decides everything about. */
class FakeSocket implements TeamSocketLike {
    readonly sent: Record<string, unknown>[] = [];
    closed = false;
    private readonly handlers: TeamSocketOptions["handlers"];

    constructor(options: TeamSocketOptions) {
        this.handlers = options.handlers;
    }

    send(text: string): void {
        this.sent.push(JSON.parse(text) as Record<string, unknown>);
    }

    close(detail = "closed"): void {
        if (this.closed) return;
        this.closed = true;
        this.handlers.onClose({ detail });
    }

    /** Pretend the server said this. */
    say(frame: Record<string, unknown>): void {
        this.handlers.onMessage(JSON.stringify(frame));
    }

    /** Pretend it opened and greeted, which is what makes a session ready. */
    greet(overrides: Record<string, unknown> = {}): void {
        this.handlers.onOpen();
        this.say({
            t: "hello",
            protocol: 2,
            server: { name: "Nomen", version: "0.1.0" },
            session: "s1",
            account: { id: "u1", username: "ada", displayName: "Ada", operator: false },
            methods: ["projects.list", "threads.list"],
            capabilities: ["session", "comments"],
            serverTime: 1,
            heartbeatMs: 30_000,
            ...overrides,
        });
    }

    /** Pretend it ended, for whatever reason. */
    drop(closed: TeamSocketClosed): void {
        if (this.closed) return;
        this.closed = true;
        this.handlers.onClose(closed);
    }
}

interface Driven {
    client: TeamClient;
    /** Every socket the client has opened, oldest first. */
    sockets: FakeSocket[];
    states: TeamConnection["state"][];
    events: { topic: string; seq: number; payload: unknown }[];
}

function drive(): Driven {
    const sockets: FakeSocket[] = [];
    const states: TeamConnection["state"][] = [];
    const events: Driven["events"] = [];
    const client = new TeamClient({
        remoteOrigin: "lore://team.example.lan:41337",
        authUrl: "https://team.example.lan:41402",
        token: "a-token",
        userDataDir: "/tmp/userdata",
        identity: { installation: "installation-1", label: "Nomen", agent: "Studio 0.0.0-test" },
        onEvent: (event) => events.push(event),
        onStatus: (connection) => states.push(connection.state),
        openSocket: (options) => {
            const socket = new FakeSocket(options);
            sockets.push(socket);
            return socket;
        },
    });
    return { client, sockets, states, events };
}

/**
 * Let the microtasks run.
 *
 * A call waits for the session before it writes anything, and that wait is a promise even
 * when the session is already there. So a test that looks at what was sent in the same
 * turn it asked sees nothing - which is a test failing on its own timing rather than on
 * the client.
 */
async function tick(times = 4): Promise<void> {
    for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/** The most recent socket, which is the one a test is usually driving. */
function current(driven: Driven): FakeSocket {
    const socket = driven.sockets.at(-1);
    if (socket === undefined) throw new Error("nothing opened a socket");
    return socket;
}

describe("reading an address", () => {
    it("takes the https origin a session is stored with", () => {
        expect(endpointOf("https://team.example.lan:41402")).toEqual({
            host: "team.example.lan",
            port: 41402,
        });
    });

    it("refuses anything that is not one, rather than guessing a port", () => {
        expect(endpointOf("lore://team.example.lan:41337")).toBeNull();
        expect(endpointOf("not an address")).toBeNull();
    });
});

describe("a session", () => {
    it("is ready once the server has greeted, and says who it is", async () => {
        const driven = drive();
        driven.client.connect();
        current(driven).greet();

        const connection = driven.client.connection();
        expect(connection.state).toBe("ready");
        expect(connection.account?.username).toBe("ada");
        expect(connection.serverName).toBe("Nomen");
        expect(driven.client.can("comments")).toBe(true);
        expect(driven.states).toEqual(["connecting", "ready"]);
    });

    it("answers a call with what the server said", async () => {
        const driven = drive();
        driven.client.connect();
        current(driven).greet();

        const asked = driven.client.call("projects.list");
        await tick();
        // The call is in flight, and the frame it sent carries the id the answer needs.
        const frame = current(driven).sent.at(-1) as { id: number; method: string };
        expect(frame.method).toBe("projects.list");
        current(driven).say({ t: "result", id: frame.id, value: { projects: [] } });

        await expect(asked).resolves.toEqual({ ok: true, value: { projects: [] } });
    });

    it("carries a refusal through with the code the server gave it", async () => {
        const driven = drive();
        driven.client.connect();
        current(driven).greet();

        const asked = driven.client.call("threads.list", { project: "nope" });
        await tick();
        const frame = current(driven).sent.at(-1) as { id: number };
        current(driven).say({ t: "error", id: frame.id, code: "not-found", message: "no such project" });

        await expect(asked).resolves.toEqual({
            ok: false,
            problem: { kind: "refused", code: "not-found", detail: "no such project" },
        });
    });

    it("does not call a method the server never said it has", async () => {
        const driven = drive();
        driven.client.connect();
        current(driven).greet();

        const before = current(driven).sent.length;
        // Checked rather than attempted: a deployment that does not do this is a screen
        // that is not drawn, not a request that comes back refused.
        await expect(driven.client.call("comments.edit", {})).resolves.toEqual({
            ok: false,
            problem: { kind: "unsupported" },
        });
        expect(current(driven).sent.length).toBe(before);
    });

    it("hands every waiting call the same failure when the socket goes", async () => {
        const driven = drive();
        driven.client.connect();
        current(driven).greet();

        const socket = current(driven);
        const asked = driven.client.call("projects.list");
        await tick();
        socket.drop({ detail: "the connection closed" });

        await expect(asked).resolves.toEqual({
            ok: false,
            problem: { kind: "offline", detail: "the connection closed" },
        });
    });
});

describe("subscriptions", () => {
    it("is told where a topic stands", async () => {
        const driven = drive();
        driven.client.connect();
        current(driven).greet();

        const asked = driven.client.subscribe("projects");
        await tick();
        const frame = current(driven).sent.at(-1) as { id: number; topic: string };
        expect(frame.topic).toBe("projects");
        current(driven).say({ t: "subscribed", id: frame.id, topic: "projects", seq: 7 });

        await expect(asked).resolves.toEqual({ ok: true, seq: 7 });
    });

    it("passes an event on to whoever is listening", () => {
        const driven = drive();
        driven.client.connect();
        current(driven).greet();
        current(driven).say({ t: "event", topic: "projects", seq: 8, payload: { kind: "project-read" } });

        expect(driven.events).toEqual([
            { topic: "projects", seq: 8, payload: { kind: "project-read" } },
        ]);
    });

    it("asks for its topics again on a session it did not ask for", async () => {
        vi.useFakeTimers();
        try {
            const driven = drive();
            driven.client.connect();
            current(driven).greet();

            const asked = driven.client.subscribe("projects");
            await tick();
            const first = current(driven).sent.at(-1) as { id: number };
            current(driven).say({ t: "subscribed", id: first.id, topic: "projects", seq: 1 });
            await asked;

            // The connection drops and the backoff elapses. A screen was never told, and
            // must not have to ask again for what it already asked for.
            current(driven).drop({ detail: "the connection closed" });
            await vi.advanceTimersByTimeAsync(2_000);
            expect(driven.sockets).toHaveLength(2);
            current(driven).greet();

            expect(current(driven).sent.map((frame) => frame["topic"])).toContain("projects");
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("when reconnecting would be pointless", () => {
    it("stops after a token the server refused", async () => {
        vi.useFakeTimers();
        try {
            const driven = drive();
            driven.client.connect();
            // 401 before any upgrade: presenting the same token faster does not make it
            // one the server will have.
            current(driven).drop({ status: 401, detail: "the token has expired" });

            await vi.advanceTimersByTimeAsync(120_000);
            expect(driven.sockets).toHaveLength(1);
            expect(driven.client.connection().state).toBe("offline");
            expect(driven.client.connection().detail).toBe("the token has expired");
        } finally {
            vi.useRealTimers();
        }
    });

    it("refuses a call rather than waiting out the whole timeout after that", async () => {
        const driven = drive();
        driven.client.connect();
        current(driven).drop({ status: 401, detail: "the token has expired" });

        await expect(driven.client.call("projects.list")).resolves.toEqual({
            ok: false,
            problem: { kind: "offline", detail: "the token has expired" },
        });
    });

    it("stops on a protocol number this build does not speak", async () => {
        vi.useFakeTimers();
        try {
            const driven = drive();
            driven.client.connect();
            current(driven).greet({ protocol: 99 });

            await vi.advanceTimersByTimeAsync(120_000);
            expect(driven.sockets).toHaveLength(1);
            expect(driven.client.connection().state).toBe("offline");
            expect(driven.client.connection().detail).toContain("99");
        } finally {
            vi.useRealTimers();
        }
    });
});

/**
 * The one thing a window may not say for itself.
 *
 * A renderer names the project it has open; which installation this is, what it is called
 * and which build come from here, because an identity a renderer could state is one a
 * plugin could state. And because presence lives in the server's memory and dies with the
 * socket, saying it once is not enough - a reconnected session that did not say it again
 * is a window nobody can see.
 */
describe("announcing this installation", () => {
    /** A server that offers the presence methods, which the plain `greet` does not. */
    const PRESENT = {
        methods: ["projects.list", "clients.announce", "clients.withdraw"],
        capabilities: ["session", "clients"],
    };

    /** Every announcement one socket carried, by the instance it named. */
    function announcements(socket: FakeSocket): string[] {
        return socket.sent
            .filter((frame) => (frame as { method?: string }).method === "clients.announce")
            .map((frame) => (frame as unknown as { params: Record<string, string> }).params["instance"] ?? "");
    }

    /** Open, greet, announce, drop, wait out the backoff, greet again. */
    async function reconnect(driven: Driven, then: (socket: FakeSocket) => void): Promise<void> {
        vi.useFakeTimers();
        try {
            current(driven).drop({ detail: "the server restarted" });
            await vi.advanceTimersByTimeAsync(2_000);
            current(driven).greet(PRESENT);
            await tick();
            then(current(driven));
        } finally {
            vi.useRealTimers();
        }
    }

    it("fills in the installation, the label and the build", async () => {
        const driven = drive();
        driven.client.connect();
        current(driven).greet(PRESENT);

        void driven.client.call("clients.announce", { project: "repo-1" });
        await tick();

        const frame = current(driven).sent.at(-1) as unknown as {
            method: string;
            params: Record<string, string>;
        };
        expect(frame.method).toBe("clients.announce");
        expect(frame.params).toMatchObject({
            project: "repo-1",
            // Composed of both halves: the installation alone would make two windows of
            // one Studio a single instance, and they would overwrite each other.
            instance: "installation-1.repo-1",
            label: "Nomen",
            agent: "Studio 0.0.0-test",
        });
    });

    it("says it again on a session that came back, without being asked twice", async () => {
        const driven = drive();
        driven.client.connect();
        current(driven).greet(PRESENT);
        void driven.client.call("clients.announce", { project: "repo-1" });
        await tick();

        await reconnect(driven, (socket) => {
            expect(announcements(socket)).toEqual(["installation-1.repo-1"]);
        });
    });

    it("stops saying it once the window has been taken back", async () => {
        const driven = drive();
        driven.client.connect();
        current(driven).greet(PRESENT);
        void driven.client.call("clients.announce", { project: "repo-1" });
        await tick();
        void driven.client.call("clients.withdraw", { project: "repo-1" });
        await tick();

        await reconnect(driven, (socket) => {
            expect(announcements(socket)).toEqual([]);
        });
    });

    it("keeps one entry per project, because one socket carries every window", async () => {
        const driven = drive();
        driven.client.connect();
        current(driven).greet(PRESENT);
        void driven.client.call("clients.announce", { project: "repo-1" });
        void driven.client.call("clients.announce", { project: "repo-2" });
        await tick();

        await reconnect(driven, (socket) => {
            expect(announcements(socket).sort())
                .toEqual(["installation-1.repo-1", "installation-1.repo-2"]);
        });
    });
});
