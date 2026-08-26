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
});
