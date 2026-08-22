/**
 * Who is told what.
 *
 * The sessions themselves are covered next door; what this is about is the bookkeeping
 * around them, and every one of these is a decision that only shows up as a bug much
 * later: an event reaching a window that never asked for it, a topic still subscribed
 * after the window that wanted it closed, a server Studio cannot produce a token for
 * being reported as a server it has never heard of.
 */
import { EventEmitter } from "events";

import { describe, expect, it } from "vitest";

import { IPCEventType } from "@shared/types/ipcEvents";
import type { TeamConnection } from "@shared/types/team";
import type { VcsServerSession } from "@shared/types/vcs";

import type { TeamClientOptions } from "./TeamClient";
import { TeamManager, type TeamClientLike } from "./TeamManager";

/** One window, in the amount of it the manager touches. */
class FakeWindow {
    readonly delivered: { event: IPCEventType; data: unknown }[] = [];
    private closed = false;

    constructor(readonly webContentsId: number) {}

    getWebContents(): { id: number } {
        return { id: this.webContentsId };
    }

    isClosed(): boolean {
        return this.closed;
    }

    isDestroyed(): boolean {
        return this.closed;
    }

    sendIpcEvent(event: IPCEventType, data: unknown): void {
        this.delivered.push({ event, data });
    }

    shut(): void {
        this.closed = true;
    }

    /** Only what this window was told on a topic, for a shorter assertion. */
    get events(): unknown[] {
        return this.delivered
            .filter((entry) => entry.event === IPCEventType.teamEvent)
            .map((entry) => entry.data);
    }
}

/** A client that records rather than connecting. */
class FakeClient implements TeamClientLike {
    readonly subscribed: string[] = [];
    readonly unsubscribed: string[] = [];
    connected = 0;
    disposed = 0;
    /** Whether a subscribe is answered or refused, which the manager acts on. */
    accept = true;

    constructor(readonly options: TeamClientOptions) {}

    connect(): void {
        this.connected += 1;
    }

    connection(): TeamConnection {
        return {
            remoteOrigin: this.options.remoteOrigin,
            state: "ready",
            capabilities: ["session"],
            since: 1,
        };
    }

    async call(): Promise<{ ok: true; value: unknown }> {
        return { ok: true, value: null };
    }

    async subscribe(topic: string): Promise<{ ok: true; seq: number } | { ok: false; problem: { kind: "unsupported" } }> {
        this.subscribed.push(topic);
        return this.accept ? { ok: true, seq: 0 } : { ok: false, problem: { kind: "unsupported" } };
    }

    async unsubscribe(topic: string): Promise<void> {
        this.unsubscribed.push(topic);
    }

    dispose(): void {
        this.disposed += 1;
    }

    /** Pretend the server pushed something. */
    push(topic: string, payload: unknown): void {
        this.options.onEvent({ topic, seq: 1, payload });
    }
}

const SERVER: VcsServerSession = {
    authUrl: "https://team.example.lan:41402",
    remoteOrigin: "lore://team.example.lan:41337",
    account: {
        userId: "u1",
        displayName: "Ada Lovelace",
        username: "ada",
        email: "",
        identity: "Ada Lovelace",
        expiresAt: 0,
    },
    signedInAt: 1,
};

interface Harness {
    manager: TeamManager;
    windows: FakeWindow[];
    clients: FakeClient[];
    closed: EventEmitter;
}

function harness(options: { token?: string | null; servers?: VcsServerSession[] } = {}): Harness {
    const windows: FakeWindow[] = [];
    const clients: FakeClient[] = [];
    const closed = new EventEmitter();
    const stored = new Map<string, string>();
    const app = {
        windowManager: {
            events: closed,
            getWindows: () => windows,
        },
        logger: { info: () => undefined, debug: () => undefined },
        // A store rather than an empty object: opening a client reads this installation's
        // own id out of it and mints one on the way past if there is none.
        getGlobalState: () => ({
            get: (key: string) => stored.get(key),
            set: (key: string, value: string) => stored.set(key, value),
        }),
        getAppInfo: () => ({ version: "0.0.0-test" }),
        getUserDataDir: () => "/tmp/userdata",
    };
    const manager = new TeamManager(
        app as never,
        () => options.servers ?? [SERVER],
        {
            tokenFor: () => (options.token === undefined ? "a-token" : options.token),
            newClient: (clientOptions) => {
                const client = new FakeClient(clientOptions);
                clients.push(client);
                return client;
            },
        },
    );
    return { manager, windows, clients, closed };
}

function window(harnessed: Harness, id: number): FakeWindow {
    const made = new FakeWindow(id);
    harnessed.windows.push(made);
    return made;
}

describe("reaching a server", () => {
    it("says it has never heard of one it has no session for", async () => {
        const team = harness();
        await expect(team.manager.call("lore://elsewhere:41337", "projects.list")).resolves.toEqual({
            ok: false,
            problem: { kind: "no-server" },
        });
    });

    it("says it cannot produce the token for one it does know", async () => {
        const team = harness({ token: null });
        await expect(team.manager.call(SERVER.remoteOrigin, "projects.list")).resolves.toEqual({
            ok: false,
            problem: { kind: "no-token" },
        });
    });

    it("holds one session however many things ask for that server", () => {
        const team = harness();
        team.manager.open(SERVER.remoteOrigin);
        team.manager.open(SERVER.remoteOrigin);
        expect(team.clients).toHaveLength(1);
        expect(team.clients[0]?.connected).toBe(2);
    });

    it("says a server nothing has asked for is idle, without opening it", () => {
        const team = harness();
        expect(team.manager.connection(SERVER.remoteOrigin).state).toBe("idle");
        expect(team.clients).toHaveLength(0);
    });
});

describe("who hears an event", () => {
    it("goes to the window that asked and to no other", async () => {
        const team = harness();
        const asked = window(team, 1);
        const other = window(team, 2);

        await team.manager.subscribe(asked as never, SERVER.remoteOrigin, "projects");
        team.clients[0]?.push("projects", { kind: "project-read" });

        expect(asked.events).toEqual([
            {
                remoteOrigin: SERVER.remoteOrigin,
                topic: "projects",
                seq: 1,
                payload: { kind: "project-read" },
            },
        ]);
        expect(other.events).toEqual([]);
    });

    it("subscribes once for two windows, and drops it when the second one lets go", async () => {
        const team = harness();
        const first = window(team, 1);
        const second = window(team, 2);

        await team.manager.subscribe(first as never, SERVER.remoteOrigin, "projects");
        await team.manager.subscribe(second as never, SERVER.remoteOrigin, "projects");
        await team.manager.unsubscribe(first as never, SERVER.remoteOrigin, "projects");
        // Still wanted by the second window, so the socket keeps it.
        expect(team.clients[0]?.unsubscribed).toEqual([]);

        await team.manager.unsubscribe(second as never, SERVER.remoteOrigin, "projects");
        expect(team.clients[0]?.unsubscribed).toEqual(["projects"]);
    });

    it("lets go of a topic when the window that wanted it was closed rather than tidy", async () => {
        const team = harness();
        const only = window(team, 1);
        await team.manager.subscribe(only as never, SERVER.remoteOrigin, "projects");

        only.shut();
        team.closed.emit("window-closed", only);

        expect(team.clients[0]?.unsubscribed).toEqual(["projects"]);
        // And nothing is sent to it afterwards.
        team.clients[0]?.push("projects", { kind: "project-read" });
        expect(only.events).toEqual([]);
    });

    it("does not keep a topic the server refused", async () => {
        const team = harness();
        const asking = window(team, 1);
        const client = () => team.clients[0];
        // Open first so the stand-in exists to be told to refuse.
        team.manager.open(SERVER.remoteOrigin);
        const made = client();
        if (made !== undefined) made.accept = false;

        const outcome = await team.manager.subscribe(asking as never, SERVER.remoteOrigin, "weather");
        expect(outcome.ok).toBe(false);

        // Nothing was recorded, so an event on that topic reaches nobody and a reconnect
        // does not ask for it again.
        made?.push("weather", { kind: "whatever" });
        expect(asking.events).toEqual([]);
    });
});

describe("letting a server go", () => {
    it("closes the session and forgets what was wanted on it", async () => {
        const team = harness();
        const asking = window(team, 1);
        await team.manager.subscribe(asking as never, SERVER.remoteOrigin, "projects");

        team.manager.forget(SERVER.remoteOrigin);

        expect(team.clients[0]?.disposed).toBe(1);
        // A second open makes a new client rather than handing back the closed one.
        team.manager.open(SERVER.remoteOrigin);
        expect(team.clients).toHaveLength(2);
    });
});
