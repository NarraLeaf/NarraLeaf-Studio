// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VcsServerSession } from "@shared/types/vcs";
import { CommitForm, ServerSection } from "./VersionRail";
import type { VersionSurface } from "../../hooks/useVersionSurface";

/**
 * The rail's server section and the commit form's author row.
 *
 * The section's suite holds the shape - Send and Get a press away, the server line reading as a
 * line, and everything that CHANGES the destination living outside the column beside them. The
 * author-name suite pins that nobody is asked a question the destination is about to answer for them.
 */
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => ({ context: null }), useOptionalWorkspace: () => null }));

const bridge = vi.hoisted(() => ({
    servers: [] as VcsServerSession[],
    /** What each server answers when the dialog asks what it holds, keyed by origin. */
    projects: {} as Record<string, unknown[]>,
    launchSettings: vi.fn(),
    listServerProjects: vi.fn(),
}));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        vcs: {
            listServers: () => Promise.resolve({ success: true, data: { servers: bridge.servers } }),
            // The add sequence is mounted from the last row of the list now. Nothing here
            // reaches for these until it is pressed, so a stub is enough to keep it honest.
            probeServer: () => Promise.resolve({ success: false }),
            addServer: () => Promise.resolve({ success: false }),
        },
        // The dialog reads a server's projects over the session now. The per-origin fake is
        // still where a test sets the answer; this reshapes it into what the wire carries.
        team: {
            call: async (remoteOrigin: string, method: string) => {
                if (method !== "projects.list") {
                    return { success: true, data: { ok: false, problem: { kind: "unsupported" } } };
                }
                const out = await bridge.listServerProjects(remoteOrigin);
                if (!out?.success) return { success: true, data: { ok: false, problem: { kind: "offline", detail: "" } } };
                return out.data.ok
                    ? { success: true, data: { ok: true, value: { projects: out.data.projects } } }
                    : { success: true, data: { ok: false, problem: out.data.problem.kind === "unreachable" ? { kind: "offline", detail: "" } : { kind: "refused", code: "refused", detail: "" } } };
            },
        },
        app: { launchSettings: bridge.launchSettings },
    }),
}));

afterEach(() => {
    cleanup();
    bridge.servers = [];
    bridge.projects = {};
    bridge.launchSettings.mockClear();
    bridge.listServerProjects.mockReset().mockImplementation((origin: string) =>
        Promise.resolve({ success: true, data: { ok: true, projects: bridge.projects[origin] ?? [] } }));
});

function session(origin: string, displayName: string, name?: string): VcsServerSession {
    return {
        remoteOrigin: origin,
        authUrl: `https://${displayName}.example.lan`,
        account: { userId: displayName, username: displayName, displayName, identity: displayName },
        ...(name === undefined ? {} : { name }),
    } as VcsServerSession;
}

const ONE = "lore://one.example.lan:41337";



/** The rail's server section, for a project already pointed at one. */
function section(overrides: Partial<VersionSurface> = {}) {
    const surface = {
        authorName: "Ada Blackwood",
        busy: null,
        failure: null,
        remote: `${ONE}/my-game`,
        remoteNeedsSignIn: false,
        syncState: null,
        serverSession: null,
        signIn: null,
        merge: null,
        checkRemote: vi.fn(),
        setRemote: vi.fn(() => Promise.resolve(true)),
        pushToRemote: vi.fn(() => Promise.resolve(true)),
        syncFromRemote: vi.fn(() => Promise.resolve(true)),
        signOutOfServer: vi.fn(() => Promise.resolve()),
        ...overrides,
    } as unknown as VersionSurface;
    render(<ServerSection surface={surface} />);
    return surface;
}

/** The commit form, for a project that could record a version right now. */
function commitForm(overrides: Partial<VersionSurface> = {}) {
    const surface = {
        // Unanswered, which is the only state the author row is ever drawn in at all. What the
        // cases below decide is whether it is drawn when it could be.
        authorName: null,
        busy: null,
        frozen: null,
        state: { kind: "current", head: "abc1234" },
        // Null is "nobody has scanned", which leaves the form present and the button live.
        status: null,
        remote: `${ONE}/my-game`,
        serverSession: null,
        commit: vi.fn(() => Promise.resolve(true)),
        setAuthorName: vi.fn(() => Promise.resolve(true)),
        ...overrides,
    } as unknown as VersionSurface;
    render(<CommitForm surface={surface} />);
    return surface;
}

function seam(name: string): HTMLElement {
    const node = document.querySelector<HTMLElement>(`[data-vcs-seam='${name}']`);
    if (node === null) throw new Error(`no [data-vcs-seam='${name}'] on screen`);
    return node;
}


/**
 * The same question in the commit form, which is where an author actually met it.
 *
 * The panel said "Signed in as Ada Lovelace" in the server section and, three lines lower, asked
 * who to sign versions as - and the name typed there was never recorded, because
 * `VcsManager.resolveIdentity` prefers the session stored for the project's own remote origin. The
 * predicate is `serverSession`, which is what `getServerSession` answered for that same remote and
 * therefore the same `storedServerSession` lookup rather than a second guess at it.
 *
 * The two rows below the divide are the ones that must not go with it: a server that signs nobody
 * in, and no server at all, are exactly the cases this row exists for.
 */
describe("the author name in the commit form", () => {
    it("is not asked while a session for this project's server stands", () => {
        commitForm({ serverSession: session(ONE, "ada", "Blackwood Studio") });

        // The form itself is still there; only the question that had already been answered is not.
        expect(document.querySelector("[data-vcs-seam='commit-form']")).not.toBeNull();
        expect(document.querySelector("[data-vcs-seam='author-identity']")).toBeNull();
    });

    it("is asked for a server that signs nobody in", () => {
        commitForm({ remote: "lore://plain.example.lan:41337/my-game" });

        expect(document.querySelector("[data-vcs-seam='author-identity']")).not.toBeNull();
    });

    it("is asked for a project on no server at all, which is the case it exists for", () => {
        commitForm({ remote: null });

        expect(document.querySelector("[data-vcs-seam='author-identity']")).not.toBeNull();
    });

    it("goes once the name has been answered, server or no server", () => {
        commitForm({ remote: null, authorName: "Ada Blackwood" });

        expect(document.querySelector("[data-vcs-seam='author-identity']")).toBeNull();
    });
});

/**
 * The rail's server section, and the weights in it.
 *
 * Send and Get are pressed every working day; choosing a server, signing in to it and disconnecting
 * are decided a handful of times in a project's life. This section used to hold all of them - the
 * host line WAS the control that opened the change-server dialog, with an overflow menu beside it
 * and a token box underneath. They live in the Team panel now, and what this suite pins is that
 * none of them came back: the section is a destination read as a fact and the two presses that use
 * it, and the way to everything else is one control that opens the panel which owns it.
 */
describe("the rail's server section", () => {
    it("keeps nothing in it that changes where the work goes", () => {
        section();

        // The three that moved. Each of them was a control in this section, and each reads as a
        // convenience to put back exactly where it used to be.
        expect(document.querySelector("[data-vcs-seam='server-menu']")).toBeNull();
        expect(document.querySelector("[data-vcs-seam='sign-in-form']")).toBeNull();
        expect(document.querySelector("[data-vcs-seam='author-identity']")).toBeNull();
        // And the dialog they reached, which covers the rail.
        expect(document.querySelector("[data-vcs-seam='server-picker']")).toBeNull();
    });

    it("keeps sending and getting a press away, at full width, with nothing in between", () => {
        const surface = section();

        expect(document.querySelector("[data-context-menu='true']")).toBeNull();
        fireEvent.click(seam("server-push"));
        fireEvent.click(seam("server-sync"));

        expect(surface.pushToRemote).toHaveBeenCalledTimes(1);
        expect(surface.syncFromRemote).toHaveBeenCalledTimes(1);
        // Both on the control scale's `sm` step and sharing the row equally: nothing was squeezed
        // in beside them, and this is what says so.
        for (const control of [seam("server-push"), seam("server-sync")]) {
            expect(control.className).toContain("h-7");
            expect(control.className).toContain("flex-1");
        }
    });

    it("names the server rather than reading out its address", () => {
        section({ serverSession: session(ONE, "ada", "Blackwood Studio") });

        expect(seam("server-name").textContent).toBe("Blackwood Studio");
        // The address is a hover away and is still what every session and project is keyed on.
        expect(seam("server-name").getAttribute("data-tip")).toBe(`${ONE}/my-game`);
    });

    it("falls back to the address for a server that gave no name", () => {
        section();

        expect(seam("server-name").textContent).toBe("one.example.lan:41337");
    });

    it("says where things stand beside the name, with the sentence behind it", () => {
        section({
            syncState: {
                remoteAvailable: true,
                remoteAuthorized: true,
                remoteBranchExists: true,
                localAhead: true,
                remoteAhead: false,
            },
        });

        expect(seam("server-state").textContent)
            .toBe("workspace.shell.versionControl.server.state.localAhead");
        expect(seam("server-state").getAttribute("data-tip"))
            .toBe("workspace.shell.versionControl.server.localAhead");
    });

    it("draws the server line as a line rather than as the control that covers the rail", () => {
        section();

        // It used to be the button that opened the change-server dialog, one line above Send, so
        // the rarest act in the feature was the easiest thing in the panel to hit.
        expect(seam("server-name").tagName).toBe("SPAN");
        expect(seam("server-state").tagName).toBe("SPAN");
    });

    it("offers nothing to connect for a project on no server", () => {
        section({ remote: null });

        // A local project becomes a team project on the Team side, from an exported project
        // package, so the rail only says there is no server.
        expect(seam("server").textContent).toContain("workspace.shell.versionControl.server.none");
        expect(document.querySelector("[data-vcs-seam='server-connect']")).toBeNull();
    });
});
