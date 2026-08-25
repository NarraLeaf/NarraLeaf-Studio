// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VcsServerSession } from "@shared/types/vcs";
import { ServerRow } from "./ServerRow";
import { serverDisplayName, serverHost } from "./serverIdentity";

/**
 * One row for three screens, and the two things it must not confuse.
 *
 * A server has a name it chose and an address everything else is keyed on. The name is
 * what a person was given in a chat message; the address is what a project's remote, a
 * stored session and an acceptance script all match against. So both are on the row, in
 * that order - and neither stands in for the other.
 *
 * The rest is the three contexts the row is drawn in, which are props rather than
 * components: a plain list with a control at its end, a row that can be chosen, and a
 * chip in a wrapping strip.
 */

const ORIGIN = "lore://team.example.lan:41337";

function session(overrides: Partial<VcsServerSession> = {}): VcsServerSession {
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
        ...overrides,
    };
}

afterEach(cleanup);

describe("naming a server", () => {
    it("reads the name it gave, and keeps the address it is known by", () => {
        const named = session({ name: "Blackwood Studio" });
        expect(serverDisplayName(named)).toBe("Blackwood Studio");
        expect(serverHost(named.remoteOrigin)).toBe("team.example.lan:41337");
    });

    it("falls back to the address for a session stored before the name was kept", () => {
        expect(serverDisplayName(session())).toBe("team.example.lan:41337");
    });

    it("reads a project's whole remote as the machine it is on", () => {
        // The name after the port belongs to the project, not to the server, and the rail
        // shows this string where a project's server is named.
        expect(serverHost("lore://team.example.lan:41337/my-game")).toBe("team.example.lan:41337");
    });

    it("shows an address it cannot parse rather than a blank where a server should be", () => {
        expect(serverHost("  not-an-address  ")).toBe("not-an-address");
    });
});

describe("the row", () => {
    it("puts the address under the name, so a project's remote can still be matched to it", () => {
        const { container } = render(<ServerRow session={session({ name: "Blackwood Studio" })} />);

        expect(container.textContent).toContain("Blackwood Studio");
        expect(container.textContent).toContain("team.example.lan:41337");
        expect(container.textContent).toContain("Ada Blackwood");
    });

    it("does not print the address twice for a server that has no name of its own", () => {
        const { container } = render(<ServerRow session={session()} />);

        expect(container.textContent?.match(/team\.example\.lan:41337/g)).toHaveLength(1);
    });

    it("carries the attributes a caller marks it with, on the row itself", () => {
        render(<ServerRow session={session()} data-servers-row={ORIGIN} />);

        expect(document.querySelector(`[data-servers-row='${ORIGIN}']`)).not.toBeNull();
    });

    it("is not a control until it is one of several to choose between", () => {
        const { container } = render(<ServerRow session={session()} />);

        expect(container.querySelector("button")).toBeNull();
    });

    it("answers a choice and says which row is the current one", () => {
        const choose = vi.fn();
        render(<ServerRow session={session()} onChoose={choose} data-server-choice={ORIGIN} />);

        const row = document.querySelector(`[data-server-choice='${ORIGIN}']`)!;
        expect(row.getAttribute("aria-pressed")).toBe("false");
        fireEvent.click(row);
        expect(choose).toHaveBeenCalled();
    });

    it("draws a chosen row as pressed", () => {
        render(<ServerRow session={session()} chosen onChoose={vi.fn()} data-server-choice={ORIGIN} />);

        expect(document.querySelector("[aria-pressed='true']")).not.toBeNull();
    });

    it("keeps a chip to the name alone, which is all a wrapping strip has room for", () => {
        const { container } = render(
            <ServerRow session={session({ name: "Blackwood Studio" })} compact size="sm" onChoose={vi.fn()} />,
        );

        expect(container.textContent).toBe("Blackwood Studio");
    });
});
