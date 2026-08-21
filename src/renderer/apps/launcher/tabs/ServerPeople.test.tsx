// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VcsServerMember } from "@shared/types/vcs";
import { ServerPeople, peopleFirst } from "./ServerPeople";

/**
 * A list of colleagues, and the one thing it must not do.
 *
 * The address is the whole test. It is read with the list because a reader who opens a
 * member wants it immediately, and it is drawn for that one member only, because a panel
 * printing every address at once is a different artefact from an address beside a version -
 * it is the kind of thing that gets photographed. So the assertions are as much about what
 * is absent from the page as about what is on it.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}(${Object.values(params).join("|")})` : key,
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        formatDate: (value: Date | number) => new Date(value).toISOString().slice(0, 10),
        formatNumber: (value: number) => String(value),
        locale: "en",
    }),
}));

const bridge = vi.hoisted(() => ({ listServerMembers: vi.fn() }));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ vcs: { listServerMembers: bridge.listServerMembers } }),
}));

const ORIGIN = "lore://team.example.lan:41337";

function member(overrides: Partial<VcsServerMember> = {}): VcsServerMember {
    return {
        username: "ada",
        displayName: "Ada Lovelace",
        email: "ada@nomen.example",
        operator: false,
        disabled: false,
        serviceAccount: false,
        ...overrides,
    };
}

function open(members: VcsServerMember[]) {
    bridge.listServerMembers.mockResolvedValue({ success: true, data: { ok: true, members } });
    render(<ServerPeople remoteOrigin={ORIGIN} />);
}

function row(username: string): HTMLElement {
    const node = document.querySelector<HTMLElement>(`[data-server-member='${username}']`);
    if (node === null) throw new Error(`no row for ${username}`);
    return node;
}

afterEach(() => {
    cleanup();
    bridge.listServerMembers.mockReset();
});

describe("a member row", () => {
    it("reads as a name and the name they answer to", async () => {
        open([member()]);

        await waitFor(() => expect(row("ada").textContent).toContain("Ada Lovelace"));
        expect(row("ada").textContent).toContain("ada");
    });

    it("does not print the address until that member is opened", async () => {
        open([member(), member({ username: "bob", displayName: "Bob Stone", email: "bob@nomen.example" })]);

        await waitFor(() => expect(document.querySelectorAll("[data-server-member]")).toHaveLength(2));
        expect(document.body.textContent).not.toContain("ada@nomen.example");
        expect(document.body.textContent).not.toContain("bob@nomen.example");

        fireEvent.click(row("ada"));

        expect(document.body.textContent).toContain("ada@nomen.example");
        // One at a time: opening a member is not opening the list.
        expect(document.body.textContent).not.toContain("bob@nomen.example");
    });

    it("closes the one already open when another is opened", async () => {
        open([member(), member({ username: "bob", displayName: "Bob Stone", email: "bob@nomen.example" })]);

        await waitFor(() => expect(document.querySelectorAll("[data-server-member]")).toHaveLength(2));
        fireEvent.click(row("ada"));
        fireEvent.click(row("bob"));

        expect(document.body.textContent).toContain("bob@nomen.example");
        expect(document.body.textContent).not.toContain("ada@nomen.example");
    });

    it("says so plainly for an account the server holds no address for", async () => {
        open([member({ email: "" })]);

        await waitFor(() => expect(document.querySelector("[data-server-member]")).not.toBeNull());
        fireEvent.click(row("ada"));

        expect(document.body.textContent).toContain("launcher.servers.people.noAddress");
    });

    it("marks an operator, a disabled account and a machine, in words", async () => {
        open([
            member({ operator: true }),
            member({ username: "bob", displayName: "Bob Stone", disabled: true }),
            member({ username: "ci", displayName: "ci", serviceAccount: true }),
        ]);

        await waitFor(() => expect(document.querySelectorAll("[data-server-member]")).toHaveLength(3));
        expect(row("ada").textContent).toContain("launcher.servers.people.operator");
        expect(row("bob").textContent).toContain("launcher.servers.people.disabled");
        expect(row("ci").textContent).toContain("launcher.servers.people.serviceAccount");
        // Nothing is marked that did not claim it.
        expect(row("ada").textContent).not.toContain("people.disabled");
    });
});

describe("the order of the list", () => {
    it("puts people before machines, and keeps the server's order within each", () => {
        const ada = member();
        const ci = member({ username: "ci", serviceAccount: true });
        const bob = member({ username: "bob" });
        const nightly = member({ username: "nightly", serviceAccount: true });

        expect(peopleFirst([ci, ada, nightly, bob])).toEqual([ada, bob, ci, nightly]);
    });
});

describe("when the server will not answer", () => {
    it("puts the refusal in words rather than showing an empty roster", async () => {
        bridge.listServerMembers.mockResolvedValue({
            success: true, data: { ok: false, problem: { kind: "refused" } },
        });
        render(<ServerPeople remoteOrigin={ORIGIN} />);

        await waitFor(() => expect(document.body.textContent)
            .toContain("launcher.servers.problem.refused"));
    });

    it("says a server holds no accounts rather than leaving the box blank", async () => {
        open([]);

        await waitFor(() => expect(document.body.textContent)
            .toContain("launcher.servers.people.none"));
    });
});
