// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VcsServerSession } from "@shared/types/vcs";
import { ServersPanel } from "./ServersPanel";

/**
 * The machine's record of the servers it is signed in to, and nothing else.
 *
 * The regression this holds off is a helpful one: a project count, a member list, the
 * name of the last person to push - all of it is true when it is written and stale the
 * moment somebody else does anything. The launcher's Servers tab is where a server's
 * contents are read, once, on the author's press; a second copy of them here would go
 * to the network on a settings page and disagree with the first.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}(${Object.values(params).join("|")})` : key,
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        formatList: (items: string[]) => items.join(" + "),
        locale: "en",
    }),
}));

const bridge = vi.hoisted(() => ({
    servers: [] as VcsServerSession[],
    forgetServer: vi.fn(() => Promise.resolve({ success: true, data: { servers: [] } })),
    teamCall: vi.fn(),
    probeServer: vi.fn(),
    addServer: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        vcs: {
            listServers: () => Promise.resolve({ success: true, data: { servers: bridge.servers } }),
            forgetServer: bridge.forgetServer,
            probeServer: bridge.probeServer,
            addServer: bridge.addServer,
        },
        team: { call: bridge.teamCall },
        app: { promptServerTrust: vi.fn() },
    }),
}));

const ORIGIN = "lore://team.example.lan:41337";

function session(): VcsServerSession {
    return {
        authUrl: "https://team.example.lan:41402",
        remoteOrigin: ORIGIN,
        account: {
            userId: "u-1",
            displayName: "Ada Blackwood",
            username: "ada",
            email: "ada@example.com",
            identity: "Ada Blackwood <ada@example.com>",
            expiresAt: 0,
        },
        signedInAt: 0,
        name: "Blackwood Studio",
    };
}

afterEach(() => {
    cleanup();
    bridge.servers = [];
    bridge.forgetServer.mockClear();
    bridge.teamCall.mockReset();
    bridge.probeServer.mockReset();
    bridge.addServer.mockReset();
});

describe("the servers panel", () => {
    it("names each server and says who this installation is signed in as", async () => {
        bridge.servers = [session()];
        render(<ServersPanel />);

        const row = await waitFor(() => {
            const node = document.querySelector<HTMLElement>(`[data-servers-row='${ORIGIN}']`);
            if (node === null) throw new Error("no row");
            return node;
        });
        expect(row.textContent).toContain("Blackwood Studio");
        expect(row.textContent).toContain("team.example.lan:41337");
        expect(row.textContent).toContain("Ada Blackwood");
    });

    it("asks no server what it holds", async () => {
        bridge.servers = [session()];
        render(<ServersPanel />);

        await waitFor(() => expect(document.querySelector(`[data-servers-row='${ORIGIN}']`)).not.toBeNull());
        // Not a count, not a member, nothing that would have to be fetched to be right.
        expect(bridge.teamCall).not.toHaveBeenCalled();
    });

    it("keeps adding one behind a press, in a dialog", async () => {
        render(<ServersPanel />);

        await waitFor(() => expect(document.body.textContent).toContain("settings.servers.empty"));
        expect(document.querySelector("[data-servers-seam='wizard-step-1']")).toBeNull();

        const open = [...document.querySelectorAll("button")]
            .find(button => button.textContent === "settings.servers.openAdd");
        fireEvent.click(open!);
        expect(document.querySelector("[data-servers-seam='wizard-step-1']")).not.toBeNull();
        // Reaching an address is the author's next act, not this one's.
        expect(bridge.probeServer).not.toHaveBeenCalled();
    });

    /**
     * A sign-in is the machine's, and a project uses it only once the author has said so - so the
     * row says which projects did. Those are the projects "Sign out" here signs out, and the
     * author reads that before pressing it rather than after.
     */
    it("names the projects that use each sign-in", async () => {
        bridge.servers = [{
            ...session(),
            usedBy: [
                { path: "D:/games/harbour", name: "Harbour Lights" },
                { path: "D:/games/lantern", name: "Lantern" },
            ],
        }];
        render(<ServersPanel />);

        const line = await waitFor(() => {
            const node = document.querySelector<HTMLElement>(`[data-servers-used-by='${ORIGIN}']`);
            if (node === null) throw new Error("no line");
            return node;
        });
        expect(line.textContent).toBe("settings.servers.usedBy(Harbour Lights + Lantern)");
        // The folders, where the names are not enough to tell two projects apart.
        expect(line.getAttribute("data-tip")).toBe("D:/games/harbour\nD:/games/lantern");
    });

    it("says where a sign-in serves no project yet", async () => {
        bridge.servers = [session()];
        render(<ServersPanel />);

        const line = await waitFor(() => {
            const node = document.querySelector<HTMLElement>(`[data-servers-used-by='${ORIGIN}']`);
            if (node === null) throw new Error("no line");
            return node;
        });
        expect(line.textContent).toBe("settings.servers.unused");
    });

    it("will not sign out of a server while a project that uses it is open, and says which", async () => {
        bridge.servers = [{
            ...session(),
            openIn: [{ path: "D:/games/harbour", name: "Harbour Lights" }],
        }];
        render(<ServersPanel />);

        const button = await waitFor(() => {
            const node = document.querySelector<HTMLButtonElement>("[data-servers-sign-out='locked']");
            if (node === null) throw new Error("no locked button");
            return node;
        });
        expect(button.disabled).toBe(true);
        expect(document.querySelector(`[data-servers-used-by='${ORIGIN}']`)?.textContent)
            .toBe("settings.servers.signOutBlocked(Harbour Lights)");
    });

    it("asks before signing out, and says which projects it takes the sign-in from", async () => {
        bridge.servers = [{ ...session(), usedBy: [{ path: "D:/games/harbour", name: "Harbour Lights" }] }];
        render(<ServersPanel />);

        const first = await waitFor(() => {
            const node = document.querySelector<HTMLButtonElement>("[data-servers-sign-out='open']");
            if (node === null) throw new Error("no button");
            return node;
        });
        fireEvent.click(first);
        expect(bridge.forgetServer).not.toHaveBeenCalled();
        expect(document.querySelector(`[data-servers-used-by='${ORIGIN}']`)?.textContent)
            .toBe("settings.servers.signOutWarning(Harbour Lights)");

        fireEvent.click(document.querySelector<HTMLButtonElement>(`[data-servers-sign-out-cancel='${ORIGIN}']`)!);
        expect(document.querySelector("[data-servers-sign-out='confirm']")).toBeNull();
        expect(bridge.forgetServer).not.toHaveBeenCalled();

        fireEvent.click(document.querySelector<HTMLButtonElement>("[data-servers-sign-out='open']")!);
        fireEvent.click(document.querySelector<HTMLButtonElement>("[data-servers-sign-out='confirm']")!);
        await waitFor(() => expect(bridge.forgetServer).toHaveBeenCalledWith(ORIGIN));
    });

    it("says so on the row when signing out did not go through", async () => {
        bridge.servers = [session()];
        bridge.forgetServer.mockImplementationOnce(() => Promise.resolve({ success: false } as never));
        render(<ServersPanel />);

        const first = await waitFor(() => {
            const node = document.querySelector<HTMLButtonElement>("[data-servers-sign-out='open']");
            if (node === null) throw new Error("no button");
            return node;
        });
        fireEvent.click(first);
        fireEvent.click(document.querySelector<HTMLButtonElement>("[data-servers-sign-out='confirm']")!);

        await waitFor(() => expect(document.querySelector(`[data-servers-used-by='${ORIGIN}']`)?.textContent)
            .toBe("settings.servers.signOutFailed"));
    });
});
