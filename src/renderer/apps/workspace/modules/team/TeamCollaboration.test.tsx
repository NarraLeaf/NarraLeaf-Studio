// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamCollaboration } from "./TeamCollaboration";
import type { TeamProjectSurface } from "../../hooks/useTeamProject";

/**
 * What the Team dialog still says about collaboration once the live session has left it.
 *
 * Two facts, both the server's, both drawn only when they have something to report: how many
 * windows have this project open, and how much is attached to it that is not in it. A section that
 * says "1 machine, 0 attached" every working day is a section nobody reads, so the whole thing goes
 * when neither has anything - which is what these cases pin, along with the one count that is easy
 * to get wrong: a record is out of date only against a head the server has actually read.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, string>) =>
            (params ? `${key}(${Object.values(params).join(",")})` : key),
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

afterEach(cleanup);

const ONE = "lore://one.example.lan:41337";

function team(overrides: Partial<TeamProjectSurface> = {}): TeamProjectSurface {
    return {
        state: {
            kind: "verified",
            project: { id: "abc", name: "my-game", description: "", createdAt: 0, remote: `${ONE}/my-game` },
        },
        remoteOrigin: ONE,
        clients: [],
        live: [],
        overlay: null,
        canLive: true,
        canOverlay: false,
        canSeeClients: false,
        refresh: vi.fn(),
        ...overrides,
    } as TeamProjectSurface;
}

function draw(overrides: Partial<TeamProjectSurface> = {}) {
    render(<TeamCollaboration team={team(overrides)} />);
}

function seam(name: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-team-seam='${name}']`);
}

function client(id: string) {
    return { id, account: "ada", label: "Nomen", agent: "", since: 0 };
}

describe("what the server says about this project", () => {
    it("draws nothing at all where there is nothing to report", () => {
        // One window, nothing attached. The section is not a heading over an empty list; it is
        // absent.
        draw({ canSeeClients: true, clients: [client("a")] });
        expect(seam("collaboration")).toBeNull();
    });

    it("counts the windows once there is more than this one", () => {
        draw({ canSeeClients: true, clients: [client("a"), client("b")] });
        expect(seam("clients")?.textContent).toBe("workspace.shell.team.hereMany(2)");
    });

    it("says nothing about a server that does not answer for this project", () => {
        // Nothing here is true of a project the server has not confirmed it holds, so the section
        // waits rather than showing the last answer under a heading that implies a live reading.
        draw({ state: { kind: "connecting" }, canSeeClients: true, clients: [client("a"), client("b")] });
        expect(seam("collaboration")).toBeNull();
    });

    it("counts attached records against the head the server read, and only where it read one", () => {
        const record = { id: "r1", anchor: { revision: "rev-1" }, kind: "comment", updatedAt: 0 };
        draw({
            canOverlay: true,
            overlay: {
                total: 2,
                head: "rev-2",
                records: [record, { ...record, id: "r2", anchor: { revision: "rev-2" } }],
            },
        } as unknown as Partial<TeamProjectSurface>);

        expect(seam("attached")?.textContent).toContain("workspace.shell.team.attached(2)");
        expect(seam("attached-outdated")?.textContent).toBe("workspace.shell.team.attachedOutdated(1)");
    });

    it("calls nothing out of date while the server has read no head", () => {
        // An absent head is a repository this server has not reached. Treating it as "everything is
        // out of date" would say so for a minute after every restart.
        const record = { id: "r1", anchor: { revision: "rev-1" }, kind: "comment", updatedAt: 0 };
        draw({
            canOverlay: true,
            overlay: { total: 1, records: [record] },
        } as unknown as Partial<TeamProjectSurface>);

        expect(seam("attached")).not.toBeNull();
        expect(seam("attached-outdated")).toBeNull();
    });
});
