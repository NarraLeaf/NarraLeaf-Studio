import { EventEmitter } from "events";

import { describe, expect, it, vi } from "vitest";

import { IPCEventType } from "@shared/types/ipcEvents";
import { TeamMethod, type TeamConnection } from "@shared/types/team";
import type { VcsServerSession } from "@shared/types/vcs";
import {
    WINDOW_SERVER_OFF_LIMITS_CODE,
    WINDOW_SIGN_IN_UNUSED_CODE,
    WindowAppType,
} from "@shared/types/window";

import type { TeamClientOptions } from "../../team/TeamClient";
import { TeamManager, type TeamClientLike } from "../../team/TeamManager";
import { readSessionUses, SESSION_USES_KEY, withSessionUse } from "../../vcs/serverSessionScope";
import {
    TeamCallHandler,
    TeamConnectionsHandler,
    TeamOpenHandler,
    TeamSubscribeHandler,
    TeamTransferHandler,
    TeamUnsubscribeHandler,
} from "./teamAction";

/**
 * Which window may speak to a Team server as this installation's account.
 *
 * The rule is the author's: a sign-in serves a (server, project) pair only once they have said so for
 * that project. The version-control channels have honoured it since the answers were first kept; the
 * Team channels are a pipe that carries any method to any server, and until these handlers asked who
 * the window was, any window could call through it as the account.
 *
 * Driven through the handlers against a real `TeamManager` and a real record of answers, because the
 * record is the thing a regression would get wrong - a yes read for the wrong project, for the wrong
 * server, or for an account that is no longer the one signed in. Only the socket is a stand-in: it
 * records what reached it, which is the whole of what "the call went out as the account" means here.
 */

const SERVER = "lore://team.example.lan:41337";
const ELSEWHERE = "lore://elsewhere.example.lan:41337";
const WIN = process.platform === "win32";
const MINE = WIN ? "D:\\games\\mine" : "/games/mine";
const THEIRS = WIN ? "D:\\games\\theirs" : "/games/theirs";

function account(remoteOrigin: string, userId: string): VcsServerSession {
    return {
        authUrl: `https://${userId}.example.lan:41402`,
        remoteOrigin,
        account: {
            userId,
            displayName: userId,
            username: userId,
            email: "",
            identity: userId,
            expiresAt: 0,
        },
        signedInAt: 1,
    };
}

/** A socket that records rather than connecting. */
class FakeClient implements TeamClientLike {
    readonly calls: string[] = [];
    readonly subscribed: string[] = [];
    connected = 0;

    constructor(readonly options: TeamClientOptions) {}

    connect(): void {
        this.connected += 1;
    }

    connection(): TeamConnection {
        return { remoteOrigin: this.options.remoteOrigin, state: "ready", capabilities: ["session"], since: 1 };
    }

    async call(method: string): Promise<{ ok: true; value: unknown }> {
        this.calls.push(method);
        return { ok: true, value: { answeredBy: this.options.remoteOrigin } };
    }

    async subscribe(topic: string): Promise<{ ok: true; seq: number }> {
        this.subscribed.push(topic);
        return { ok: true, seq: 0 };
    }

    async unsubscribe(): Promise<void> {}

    dispose(): void {}

    push(topic: string): void {
        this.options.onEvent({ topic, seq: 1, payload: {} });
    }
}

/** One window, in the amount of it the handlers and the manager touch. */
interface FakeWindow {
    app: { getTeamManager: () => TeamManager };
    delivered: IPCEventType[];
    getWindowType(): WindowAppType;
    getProps(): { projectPath?: string };
    getWebContents(): { id: number };
    isClosed(): boolean;
    isDestroyed(): boolean;
    sendIpcEvent(event: IPCEventType): void;
}

interface Harness {
    team: TeamManager;
    clients: FakeClient[];
    state: Map<string, unknown>;
    window(type: WindowAppType, projectPath?: string): FakeWindow;
    /** What the author said, as `VcsManager` records it. */
    answer(projectPath: string, remoteOrigin: string, userId: string | null): void;
}

function harness(sessions: VcsServerSession[] = [account(SERVER, "u-ada"), account(ELSEWHERE, "u-bea")]): Harness {
    const windows: FakeWindow[] = [];
    const clients: FakeClient[] = [];
    const state = new Map<string, unknown>();
    const app = {
        windowManager: { events: new EventEmitter(), getWindows: () => windows },
        logger: { info: () => undefined, debug: () => undefined, warn: () => undefined },
        getGlobalState: () => ({
            get: (key: string) => state.get(key),
            set: (key: string, value: unknown) => state.set(key, value),
        }),
        getAppInfo: () => ({ version: "0.0.0-test" }),
        getUserDataDir: () => "/tmp/userdata",
    };
    const team = new TeamManager(app as never, () => sessions, {
        tokenFor: () => "a-token",
        newClient: (options) => {
            const client = new FakeClient(options);
            clients.push(client);
            return client;
        },
    });
    let next = 1;
    return {
        team,
        clients,
        state,
        window(type, projectPath) {
            const id = next++;
            const made: FakeWindow = {
                app: { getTeamManager: () => team },
                delivered: [],
                getWindowType: () => type,
                getProps: () => (projectPath === undefined ? {} : { projectPath }),
                getWebContents: () => ({ id }),
                isClosed: () => false,
                isDestroyed: () => false,
                sendIpcEvent(event) {
                    made.delivered.push(event);
                },
            };
            windows.push(made);
            return made;
        },
        answer(projectPath, remoteOrigin, userId) {
            // Written the way `VcsManager` writes an answer, so the key is the one it would read.
            state.set(SESSION_USES_KEY, withSessionUse(readSessionUses(state.get(SESSION_USES_KEY)), {
                remoteOrigin,
                projectPath,
                userId,
                at: 1,
            }));
        },
    };
}

/** What the four project-bound channels answer a window, one request each. */
async function askAll(window: FakeWindow, remoteOrigin = SERVER) {
    const asWindow = window as never;
    return {
        open: await new TeamOpenHandler().handle(asWindow, { remoteOrigin }),
        call: await new TeamCallHandler().handle(asWindow, { remoteOrigin, method: TeamMethod.projectsList }),
        subscribe: await new TeamSubscribeHandler().handle(asWindow, { remoteOrigin, topic: "projects" }),
        transfer: await new TeamTransferHandler().handle(asWindow, {
            action: "resume",
            remoteOrigin,
            project: "p1",
        }),
    };
}

function expectRefusedAll(answers: Awaited<ReturnType<typeof askAll>>, code: string): void {
    for (const [channel, answer] of Object.entries(answers)) {
        expect(answer, channel).toMatchObject({ success: false, code });
    }
}

describe("a workspace", () => {
    function transferStandIn(team: TeamManager) {
        // The bytes have a suite of their own; what is pinned here is whether a request got that far.
        const transfer = vi.fn(async () => ({ ok: true as const, kind: "accepted" as const }));
        team.transfer = transfer;
        return transfer;
    }

    it("reaches a server for its own project once the author said that project uses the sign-in there", async () => {
        const { team, clients, window, answer } = harness();
        const transfer = transferStandIn(team);
        answer(MINE, SERVER, "u-ada");

        const answers = await askAll(window(WindowAppType.Workspace, MINE));

        for (const [channel, answered] of Object.entries(answers)) {
            expect(answered, channel).toMatchObject({ success: true });
        }
        expect(clients[0]?.calls).toEqual([TeamMethod.projectsList]);
        expect(clients[0]?.subscribed).toEqual(["projects"]);
        expect(transfer).toHaveBeenCalledTimes(1);
    });

    it("is refused for a project the author was never asked about, and nothing reaches the server", async () => {
        const { team, clients, window } = harness();
        const transfer = transferStandIn(team);

        expectRefusedAll(await askAll(window(WindowAppType.Workspace, MINE)), WINDOW_SIGN_IN_UNUSED_CODE);
        expect(clients).toEqual([]);
        expect(transfer).not.toHaveBeenCalled();
    });

    it("is refused for a project the author said does not use it", async () => {
        const { team, clients, window, answer } = harness();
        transferStandIn(team);
        answer(MINE, SERVER, null);

        expectRefusedAll(await askAll(window(WindowAppType.Workspace, MINE)), WINDOW_SIGN_IN_UNUSED_CODE);
        expect(clients).toEqual([]);
    });

    /** The hole itself: another project's yes was the whole of what any window needed. */
    it("is refused on the strength of another project's yes", async () => {
        const { team, clients, window, answer } = harness();
        transferStandIn(team);
        answer(THEIRS, SERVER, "u-ada");

        expectRefusedAll(await askAll(window(WindowAppType.Workspace, MINE)), WINDOW_SIGN_IN_UNUSED_CODE);
        expect(clients).toEqual([]);
    });

    it("is refused at a server its project said nothing about, though it uses the sign-in at another", async () => {
        const { team, clients, window, answer } = harness();
        transferStandIn(team);
        answer(MINE, SERVER, "u-ada");

        expectRefusedAll(await askAll(window(WindowAppType.Workspace, MINE), ELSEWHERE), WINDOW_SIGN_IN_UNUSED_CODE);
        expect(clients).toEqual([]);
    });

    it("is refused where the yes was given to an account that is no longer the one signed in", async () => {
        const { team, clients, window, answer } = harness([account(SERVER, "u-ben")]);
        transferStandIn(team);
        answer(MINE, SERVER, "u-ada");

        expectRefusedAll(await askAll(window(WindowAppType.Workspace, MINE)), WINDOW_SIGN_IN_UNUSED_CODE);
        expect(clients).toEqual([]);
    });

    it("is not given the list of every server, even for a project that uses a sign-in", async () => {
        const { window, answer } = harness();
        answer(MINE, SERVER, "u-ada");

        const answered = await new TeamConnectionsHandler().handle(window(WindowAppType.Workspace, MINE) as never);
        expect(answered).toMatchObject({ success: false, code: WINDOW_SERVER_OFF_LIMITS_CODE });
    });

    /**
     * The moment an author says no is the moment the Team panel tidies up: it withdraws this
     * window's presence and lets its topics go. Refusing those would leave this machine listed on a
     * project the author just took off the server, and the socket replays an announcement on every
     * reconnect until something withdraws it.
     */
    describe("whose project has stopped using the sign-in", () => {
        it("still takes its presence back, over the session that is already open", async () => {
            const { clients, window, answer, state } = harness();
            answer(MINE, SERVER, "u-ada");
            const workspace = window(WindowAppType.Workspace, MINE);
            await new TeamCallHandler().handle(workspace as never, {
                remoteOrigin: SERVER,
                method: TeamMethod.clientsAnnounce,
                params: { project: "p1" },
            });
            // The author says no from the Team panel.
            answer(MINE, SERVER, null);

            const withdrawn = await new TeamCallHandler().handle(workspace as never, {
                remoteOrigin: SERVER,
                method: TeamMethod.clientsWithdraw,
                params: { project: "p1" },
            });

            expect(withdrawn).toMatchObject({ success: true });
            expect(clients[0]?.calls).toEqual([TeamMethod.clientsAnnounce, TeamMethod.clientsWithdraw]);
        });

        it("never opens a session to let go of something it never said", async () => {
            const { clients, window } = harness();

            const withdrawn = await new TeamCallHandler().handle(window(WindowAppType.Workspace, MINE) as never, {
                remoteOrigin: SERVER,
                method: TeamMethod.clientsWithdraw,
                params: { project: "p1" },
            });

            expect(withdrawn).toMatchObject({ success: true, data: { ok: true } });
            expect(clients).toEqual([]);
        });

        it("stops hearing about topics it held while it used the sign-in", async () => {
            const { clients, window, answer, state } = harness();
            answer(MINE, SERVER, "u-ada");
            const workspace = window(WindowAppType.Workspace, MINE);
            await new TeamSubscribeHandler().handle(workspace as never, { remoteOrigin: SERVER, topic: "projects" });
            clients[0]?.push("projects");
            expect(workspace.delivered.filter(event => event === IPCEventType.teamEvent)).toHaveLength(1);

            answer(MINE, SERVER, null);
            clients[0]?.push("projects");

            expect(workspace.delivered.filter(event => event === IPCEventType.teamEvent)).toHaveLength(1);
        });

        it("lets its topics go, which only ever takes its own interest away", async () => {
            const { window } = harness();

            const answered = await new TeamUnsubscribeHandler().handle(
                window(WindowAppType.Workspace, MINE) as never,
                { remoteOrigin: SERVER, topic: "projects" },
            );

            expect(answered).toMatchObject({ success: true });
        });
    });
});

describe("the launcher", () => {
    it("speaks to a server as the account, since it is the account's own console for one", async () => {
        const { clients, window } = harness();
        const launcher = window(WindowAppType.Launcher);

        expect(await new TeamOpenHandler().handle(launcher as never, { remoteOrigin: SERVER }))
            .toMatchObject({ success: true });
        expect(await new TeamConnectionsHandler().handle(launcher as never)).toMatchObject({ success: true });
        expect(await new TeamCallHandler().handle(launcher as never, {
            remoteOrigin: SERVER,
            method: TeamMethod.threadsCreate,
            params: {},
        })).toMatchObject({ success: true });
        expect(await new TeamSubscribeHandler().handle(launcher as never, { remoteOrigin: SERVER, topic: "projects" }))
            .toMatchObject({ success: true });
        expect(clients[0]?.calls).toEqual([TeamMethod.threadsCreate]);
    });

    it("moves no bytes: a transfer is a file of a project, and it has no project", async () => {
        const { team, window } = harness();
        const transfer = vi.fn();
        team.transfer = transfer;

        const answered = await new TeamTransferHandler().handle(window(WindowAppType.Launcher) as never, {
            action: "resume",
            remoteOrigin: SERVER,
            project: "p1",
        });
        expect(answered).toMatchObject({ success: false, code: WINDOW_SERVER_OFF_LIMITS_CODE });
        expect(transfer).not.toHaveBeenCalled();
    });

    it("is refused the administration methods, which Studio never calls", async () => {
        const { clients, window } = harness();

        const answered = await new TeamCallHandler().handle(window(WindowAppType.Launcher) as never, {
            remoteOrigin: SERVER,
            method: TeamMethod.adminTokensMint,
        });
        expect(answered).toMatchObject({ success: false, code: WINDOW_SERVER_OFF_LIMITS_CODE });
        expect(clients).toEqual([]);
    });
});

/**
 * The two windows that list a server's projects before any project here has answered: Settings once
 * a server is added, and the wizard's server picker, which runs before the project it clones exists.
 */
describe("Settings and the project wizard", () => {
    for (const type of [WindowAppType.Settings, WindowAppType.ProjectWizard]) {
        it(`${type} lists what a server holds, and does nothing else there`, async () => {
            const { clients, window } = harness();
            const asking = window(type);

            expect(await new TeamCallHandler().handle(asking as never, {
                remoteOrigin: SERVER,
                method: TeamMethod.projectsList,
            })).toMatchObject({ success: true });
            expect(await new TeamCallHandler().handle(asking as never, {
                remoteOrigin: SERVER,
                method: TeamMethod.projectsForget,
                params: { project: "p1" },
            })).toMatchObject({ success: false, code: WINDOW_SERVER_OFF_LIMITS_CODE });
            expect(await new TeamSubscribeHandler().handle(asking as never, { remoteOrigin: SERVER, topic: "projects" }))
                .toMatchObject({ success: false, code: WINDOW_SERVER_OFF_LIMITS_CODE });
            expect(await new TeamOpenHandler().handle(asking as never, { remoteOrigin: SERVER }))
                .toMatchObject({ success: false, code: WINDOW_SERVER_OFF_LIMITS_CODE });

            expect(clients[0]?.calls).toEqual([TeamMethod.projectsList]);
        });
    }
});

describe("a window that never speaks to servers", () => {
    it("is refused all of it - Dev Mode too, on a project that uses the sign-in", async () => {
        const { team, clients, window, answer } = harness();
        team.transfer = vi.fn();
        answer(MINE, SERVER, "u-ada");

        expectRefusedAll(await askAll(window(WindowAppType.DevMode, MINE)), WINDOW_SERVER_OFF_LIMITS_CODE);
        expectRefusedAll(await askAll(window(WindowAppType.ServerSessionPrompt)), WINDOW_SERVER_OFF_LIMITS_CODE);
        expect(await new TeamTransferHandler().handle(window(WindowAppType.DevMode, MINE) as never, { action: "status" }))
            .toMatchObject({ success: false, code: WINDOW_SERVER_OFF_LIMITS_CODE });
        expect(clients).toEqual([]);
    });

    it("is not told where a server stands, which names the account signed in there", async () => {
        const { window, answer } = harness();
        answer(MINE, SERVER, "u-ada");
        const devMode = window(WindowAppType.DevMode, MINE);
        const unused = window(WindowAppType.Workspace, THEIRS);
        const launcher = window(WindowAppType.Launcher);
        const workspace = window(WindowAppType.Workspace, MINE);

        await new TeamOpenHandler().handle(launcher as never, { remoteOrigin: SERVER });
        // What the manager pushes when a session's state moves.
        const announced = IPCEventType.teamConnectionChanged;
        (launcher.app.getTeamManager() as unknown as { announce(connection: TeamConnection): void })
            .announce({ remoteOrigin: SERVER, state: "ready", capabilities: [], since: 2 });

        expect(launcher.delivered).toContain(announced);
        expect(workspace.delivered).toContain(announced);
        expect(devMode.delivered).not.toContain(announced);
        expect(unused.delivered).not.toContain(announced);
    });
});
