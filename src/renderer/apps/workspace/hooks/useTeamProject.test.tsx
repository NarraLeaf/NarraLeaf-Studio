// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTeamProject } from "./useTeamProject";

/**
 * The workspace checking its own server, without anybody pressing anything.
 *
 * Until this existed, everything the workspace knew about its server was read off this
 * disk - the address out of the repository's config, the account out of the machine's
 * session list - and the only thing that ever contacted the server was a row called
 * "Check". A project pointed at a host that is switched off, at a server that no longer
 * holds it, or at a revoked account read as a working connection right up until Send was
 * refused.
 *
 * Four things are pinned here, and each is a claim that only holds because the server is
 * asked rather than remembered:
 *
 *  - **The project is matched by repository id**, which is the only identity that survives
 *    a rename on either side. A folder copied from a colleague carries their address and
 *    their name and is still not their project.
 *  - **"Not there" is a state**, said before Send is refused rather than by it.
 *  - **A failed read never replaces a good one.** A server that stopped answering has not
 *    deleted anything, and drawing the empty state would turn "could not ask" into
 *    "there is nothing".
 *  - **A project with no server opens nothing**, so a window with no repository holds no
 *    session.
 */

const bridge = vi.hoisted(() => ({
    open: vi.fn(),
    call: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onConnectionChanged: vi.fn(),
    onEvent: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ team: bridge }),
}));

const ONE = "lore://one.example.lan:41337";
const REPO = "1a2b3c4d5e6f70819a2b3c4d5e6f7081";

/** A session that is open and offers everything. */
function ready(capabilities = ["session", "clients", "live", "overlay"]) {
    return {
        success: true,
        data: {
            remoteOrigin: ONE,
            state: "ready",
            capabilities,
            since: 1,
        },
    };
}

/** What one call answered, by method. Anything unnamed answers with an empty collection. */
function answers(byMethod: Record<string, unknown>): void {
    bridge.call.mockImplementation((_origin: string, method: string) => {
        const value = byMethod[method];
        return Promise.resolve({
            success: true,
            data: value === undefined
                ? { ok: false, problem: { kind: "unsupported" } }
                : { ok: true, value },
        });
    });
}

afterEach(() => {
    cleanup();
    bridge.open.mockReset();
    bridge.call.mockReset();
    bridge.subscribe.mockReset().mockResolvedValue({ success: true });
    bridge.unsubscribe.mockReset().mockResolvedValue({ success: true });
    bridge.onConnectionChanged.mockReset().mockReturnValue({ cancel: vi.fn() });
    bridge.onEvent.mockReset().mockReturnValue({ cancel: vi.fn() });
});

/** One project row as the server serves it. */
function project(id: string, name = "lighthouse") {
    return { id, name, description: "", createdAt: 1, remote: `${ONE}/${name}` };
}

describe("checking this project's server", () => {
    it("opens nothing for a project that has no server", () => {
        const { result } = renderHook(() => useTeamProject(null, null));
        expect(result.current.state).toEqual({ kind: "none" });
        expect(bridge.open).not.toHaveBeenCalled();
    });

    it("confirms the project by repository id, not by the name in the address", async () => {
        bridge.open.mockResolvedValue(ready());
        answers({
            "projects.list": { projects: [project(REPO, "something-else")] },
            "clients.announce": { client: { id: `me.${REPO}`, account: "ada", label: "Nomen", agent: "", since: 1 } },
            "clients.list": { clients: [] },
            "live.list": { sessions: [] },
            "overlay.list": { records: [], total: 0, head: "rev-9" },
        });

        const { result } = renderHook(() => useTeamProject(`${ONE}/my-game`, REPO));

        await waitFor(() => expect(result.current.state.kind).toBe("verified"));
        expect(result.current.head).toBe("rev-9");
        // Learnt from the answer rather than worked out here: composing an instance id in
        // the renderer would be composing one it could just as well make up.
        await waitFor(() => expect(result.current.instance).toBe(`me.${REPO}`));
    });

    it("says the server does not hold it when the id is not in the list", async () => {
        bridge.open.mockResolvedValue(ready());
        answers({ "projects.list": { projects: [project("a".repeat(32))] } });

        const { result } = renderHook(() => useTeamProject(`${ONE}/my-game`, REPO));

        await waitFor(() => expect(result.current.state.kind).toBe("not-there"));
    });

    it("says a server it cannot open a session with is not one to wait for", async () => {
        // What the main process answers for a server this machine has no record of, or no
        // readable token for: neither reaches a socket, so there is no transport sentence
        // and no amount of waiting that helps.
        bridge.open.mockResolvedValue({
            success: true,
            data: {
                remoteOrigin: ONE,
                state: "offline",
                capabilities: [],
                problem: { kind: "no-token" },
                detail: "this installation cannot read its token for that server",
                since: 1,
            },
        });

        const { result } = renderHook(() => useTeamProject(`${ONE}/my-game`, REPO));

        await waitFor(() => expect(result.current.state.kind).toBe("no-account"));
    });

    it("reports a host that is not answering as unreachable rather than as missing", async () => {
        bridge.open.mockResolvedValue({
            success: true,
            data: {
                remoteOrigin: ONE,
                state: "offline",
                capabilities: [],
                detail: "connect ECONNREFUSED",
                since: 1,
            },
        });

        const { result } = renderHook(() => useTeamProject(`${ONE}/my-game`, REPO));

        await waitFor(() => expect(result.current.state).toEqual({
            kind: "unreachable",
            detail: "connect ECONNREFUSED",
        }));
    });

    it("keeps the last good answer when a later read fails", async () => {
        bridge.open.mockResolvedValue(ready());
        answers({
            "projects.list": { projects: [project(REPO)] },
            "clients.announce": { client: { id: "me", account: "ada", label: "Nomen", agent: "", since: 1 } },
            "clients.list": { clients: [] },
            "live.list": { sessions: [] },
            "overlay.list": {
                total: 1,
                head: "rev-9",
                records: [{
                    id: "r1",
                    project: REPO,
                    anchor: { document: "story/act-one.json", revision: "rev-9" },
                    kind: "review",
                    body: "{}",
                    createdAt: 1,
                    updatedAt: 1,
                }],
            },
        });
        const { result } = renderHook(() => useTeamProject(`${ONE}/my-game`, REPO));
        await waitFor(() => expect(result.current.overlay?.total).toBe(1));

        // The server stops answering. Nothing here was deleted, so nothing here may be
        // emptied - a screen drawing "nothing is attached" would be saying something the
        // server never said.
        bridge.call.mockResolvedValue({
            success: true,
            data: { ok: false, problem: { kind: "offline", detail: "gone" } },
        });
        result.current.refresh();

        await new Promise((settle) => setTimeout(settle, 20));
        expect(result.current.overlay?.total).toBe(1);
        expect(result.current.state.kind).toBe("verified");
    });

    it("asks for nothing a deployment does not offer", async () => {
        bridge.open.mockResolvedValue(ready(["session"]));
        answers({ "projects.list": { projects: [project(REPO)] } });

        const { result } = renderHook(() => useTeamProject(`${ONE}/my-game`, REPO));
        await waitFor(() => expect(result.current.state.kind).toBe("verified"));

        const asked = bridge.call.mock.calls.map((call) => call[1] as string);
        // Checked rather than attempted, which is the same bargain the capability list is
        // everywhere else: a screen for something a deployment does not offer is simply
        // not drawn.
        expect(asked).not.toContain("overlay.list");
        expect(asked).not.toContain("live.list");
        expect(asked).not.toContain("clients.announce");
    });
});
