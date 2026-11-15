// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamConnection } from "@shared/types/team";
import { TeamAccountAvatar } from "./TeamAccountAvatar";
import { registerTeamHistoryBridge } from "./teamHistoryController";
import { registerTeamPresenceBridge } from "./teamPresenceController";

/**
 * The account in the title bar: drawn only while there is a session, ringed in a team project,
 * and pressed for the name, the bio, who is online and the way into the Team panel.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, vars?: Record<string, string>) => (vars?.count === undefined ? key : `${key}:${vars.count}`),
        has: () => false,
        tn: (key: string) => key,
        locale: "en",
    }),
}));

const ORIGIN = "lore://team.example.lan:41337";

const state = vi.hoisted(() => ({
    connection: null as TeamConnection | null,
    documents: { view: null as unknown, target: null as { remoteOrigin: string; project: string } | null },
    visible: true,
    projectOrigin: "lore://team.example.lan:41337" as string | null,
    servers: [] as { remoteOrigin: string; signedInAt: number; account?: { userId: string; username: string; displayName: string } }[],
    calls: [] as { method: string; params: unknown }[],
}));

vi.mock("./TeamProjectContext", () => ({
    useTeamProjectSurface: () => ({ remoteOrigin: state.projectOrigin, state: { kind: "none" } }),
}));
vi.mock("./TeamHistoryRail", () => ({
    useTeamDocuments: () => ({ ...state.documents, previewing: null, detached: null, service: null }),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        team: {
            open: () => Promise.resolve(state.connection === null
                ? { success: false }
                : { success: true, data: state.connection }),
            call: (_origin: string, method: string, params: Record<string, unknown>) => {
                state.calls.push({ method, params });
                if (method === "account.profile.get") {
                    const username = (params?.username as string | undefined) ?? "lightdust";
                    return Promise.resolve({
                        success: true,
                        data: {
                            ok: true,
                            value: {
                                profile: username === "lightdust"
                                    ? { username, displayName: "Light Dust", bio: "Writes the night scenes" }
                                    : { username, displayName: "Sin Yoo" },
                            },
                        },
                    });
                }
                if (method === "clients.list") {
                    return Promise.resolve({
                        success: true,
                        data: {
                            ok: true,
                            value: {
                                clients: [
                                    { id: "a", account: "lightdust", label: "Mac", agent: "", since: 1 },
                                    { id: "b", account: "sinyoo", label: "PC", agent: "", since: 2 },
                                    { id: "c", account: "lightdust", label: "Laptop", agent: "", since: 3 },
                                ],
                            },
                        },
                    });
                }
                return Promise.resolve({ success: false });
            },
            avatar: () => Promise.resolve({ success: true, data: { dataUrl: null } }),
            subscribe: () => Promise.resolve({ success: true, data: { ok: true, value: {} } }),
            unsubscribe: () => Promise.resolve({ success: true }),
            onConnectionChanged: () => ({ cancel: vi.fn() }),
            onEvent: () => ({ cancel: vi.fn() }),
        },
        vcs: {
            listServers: () => Promise.resolve({ success: true, data: { servers: state.servers } }),
        },
        app: {
            state: {
                getGlobalState: () => Promise.resolve({ success: true, data: { value: state.visible } }),
                onGlobalStateChanged: () => ({ cancel: vi.fn() }),
            },
        },
    }),
}));

function ready(capabilities: TeamConnection["capabilities"] = ["clients"]): TeamConnection {
    return {
        remoteOrigin: ORIGIN,
        state: "ready",
        capabilities,
        account: { id: "1", username: "lightdust", displayName: "Light Dust", operator: false },
        since: 1,
    };
}

async function draw() {
    const view = render(<TeamAccountAvatar />);
    // Let the session, the setting and the profile reads land.
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
    return view;
}

beforeEach(() => {
    state.connection = null;
    state.documents = { view: null, target: null };
    state.visible = true;
    state.projectOrigin = ORIGIN;
    state.servers = [];
    state.calls = [];
});
afterEach(cleanup);

describe("when it is drawn", () => {
    it("is not drawn without a session with a Team server", async () => {
        const { container } = await draw();
        expect(container.querySelector("[data-team-account]")).toBeNull();
    });

    it("is not drawn when the author hid it", async () => {
        state.connection = ready();
        state.visible = false;
        const { container } = await draw();
        expect(container.querySelector("[data-team-account]")).toBeNull();
    });

    it("is drawn once there is a session, with no ring outside a team project", async () => {
        state.connection = ready();
        const { container } = await draw();
        const button = container.querySelector("[data-team-account]");
        expect(button?.getAttribute("data-team-account")).toBe("connected");
        expect(button?.innerHTML).not.toContain("ring-primary");
    });

    it("is drawn in a project on no server, through the latest sign-in", async () => {
        state.connection = ready();
        state.projectOrigin = null;
        state.servers = [
            { remoteOrigin: "lore://old.example.lan:41337", signedInAt: 1 },
            { remoteOrigin: ORIGIN, signedInAt: 2 },
        ];
        const { container } = await draw();
        expect(container.querySelector("[data-team-account]")?.getAttribute("data-team-account")).toBe("connected");
    });

    it("is not drawn in a project on no server when nothing is signed in", async () => {
        state.connection = ready();
        state.projectOrigin = null;
        const { container } = await draw();
        expect(container.querySelector("[data-team-account]")).toBeNull();
    });

    it("wears the ring in a team project", async () => {
        state.connection = ready();
        state.documents = { view: {}, target: { remoteOrigin: ORIGIN, project: "p1" } };
        const { container } = await draw();
        const button = container.querySelector("[data-team-account]");
        expect(button?.getAttribute("data-team-account")).toBe("team-project");
        expect(button?.innerHTML).toContain("ring-primary");
    });
});

describe("while the server is not answering", () => {
    const signedIn = { remoteOrigin: ORIGIN, signedInAt: 1, account: { userId: "1", username: "lightdust", displayName: "Light Dust" } };

    it("still shows the account recorded at sign-in, marked as not connected", async () => {
        state.servers = [signedIn];
        const { container } = await draw();
        const button = container.querySelector("[data-team-account]");
        expect(button?.getAttribute("data-team-account")).toBe("offline");
        expect(button?.getAttribute("data-tip")).toContain("workspace.shell.team.account.offline");
        fireEvent.click(button!);
        const card = container.querySelector("[data-team-account-card]")!;
        expect(card.textContent).toContain("Light Dust");
        expect(card.querySelector("[data-team-account-offline]")).not.toBeNull();
    });

    it("lists nobody online, since it cannot know", async () => {
        state.servers = [signedIn];
        state.documents = { view: {}, target: { remoteOrigin: ORIGIN, project: "p1" } };
        const { container } = await draw();
        fireEvent.click(container.querySelector("[data-team-account]")!);
        expect(container.querySelector("[data-team-account-online]")).toBeNull();
    });
});

describe("the card", () => {
    it("shows the name and the bio beside the face", async () => {
        state.connection = ready();
        const { container } = await draw();
        fireEvent.click(container.querySelector("[data-team-account]")!);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        const card = container.querySelector("[data-team-account-card]")!;
        expect(card.textContent).toContain("Light Dust");
        expect(card.textContent).toContain("Writes the night scenes");
        // No online list outside a team project.
        expect(card.querySelector("[data-team-account-online]")).toBeNull();
    });

    it("lists each account online in the team project once", async () => {
        state.connection = ready();
        state.documents = { view: {}, target: { remoteOrigin: ORIGIN, project: "p1" } };
        const { container } = await draw();
        fireEvent.click(container.querySelector("[data-team-account]")!);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        const rows = Array.from(container.querySelectorAll("[data-team-online]")).map(row => row.getAttribute("data-team-online"));
        expect(rows).toEqual(["lightdust", "sinyoo"]);
        expect(screen.getByText("Sin Yoo")).toBeTruthy();
        expect(state.calls.some(call => call.method === "clients.list" && (call.params as { project?: string }).project === "p1")).toBe(true);
    });

    it("opens the same Team panel as the status bar cell", async () => {
        state.connection = ready();
        const open = vi.fn();
        const forget = registerTeamPresenceBridge({ open });
        try {
            const { container } = await draw();
            fireEvent.click(container.querySelector("[data-team-account]")!);
            fireEvent.click(container.querySelector("[data-team-account-act='manage']")!);
            expect(open).toHaveBeenCalledTimes(1);
            expect(container.querySelector("[data-team-account-card]")).toBeNull();
        } finally {
            forget();
        }
    });

    it("never rings the face inside the card", async () => {
        state.connection = ready();
        state.documents = { view: {}, target: { remoteOrigin: ORIGIN, project: "p1" } };
        const { container } = await draw();
        fireEvent.click(container.querySelector("[data-team-account]")!);
        const card = container.querySelector("[data-team-account-card]")!;
        expect(card.firstElementChild?.innerHTML).not.toContain("ring-primary");
    });

    it("opens the version history in a team project, and offers no history elsewhere", async () => {
        state.connection = ready();
        const open = vi.fn();
        const forget = registerTeamHistoryBridge({ open });
        try {
            const outside = await draw();
            fireEvent.click(outside.container.querySelector("[data-team-account]")!);
            expect(outside.container.querySelector("[data-team-account-act='history']")).toBeNull();
            outside.unmount();

            state.documents = { view: {}, target: { remoteOrigin: ORIGIN, project: "p1" } };
            const inside = await draw();
            fireEvent.click(inside.container.querySelector("[data-team-account]")!);
            fireEvent.click(inside.container.querySelector("[data-team-account-act='history']")!);
            expect(open).toHaveBeenCalledTimes(1);
            expect(inside.container.querySelector("[data-team-account-card]")).toBeNull();
        } finally {
            forget();
        }
    });
});
