// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVERS_PANEL_SETTING_KEY } from "@shared/constants/servers";
import type { VcsServerSession } from "@shared/types/vcs";
import { CommitForm, ServerPickerDialog, ServerSection } from "./VersionRail";
import type { VersionSurface } from "../../hooks/useVersionSurface";

/**
 * The dialog picks a server. It does not describe one and it does not add one.
 *
 * Adding is a Settings act - a token signs the whole installation in - so the last row of the
 * list opens Settings there and this dialog closes. The three things that regress are pinned
 * below, because each of them reads as a convenience while it is being written: an address
 * being preselected for a project that has no server, the add row drifting away from the list
 * it belongs to, and pressing it leaving this dialog up over a list it will not re-read.
 *
 * The rail section that reaches this dialog is pinned in the same file, for the same reason: the
 * two are one decision about how much weight a once-a-year act is given, and the drift is always
 * in the direction of giving it more. So the section's own suite below holds the shape - Send and
 * Get a press away, everything rare behind the menu, and the server line reading as a line rather
 * than as the button that covers the rail.
 *
 * Between them are the two suites about the author name, one per place the rail asks for it. They
 * are one rule read twice, and the rule is that nobody is asked a question the destination is about
 * to answer for them.
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

vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => ({ context: null }) }));

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
            listServerProjects: bridge.listServerProjects,
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
const TWO = "lore://two.example.lan:41337";

function picker(remote: string | null, overrides: Partial<VersionSurface> = {}) {
    const onClose = vi.fn();
    const surface = {
        // Answered, so the author-name offer stays out of the way of the cases that are not
        // about it. The cases that are pass `authorName: null` and read where it appears.
        authorName: "Ada Blackwood",
        busy: null,
        failure: null,
        remote,
        remoteNeedsSignIn: false,
        setRemote: vi.fn(() => Promise.resolve(true)),
        publish: vi.fn(() => Promise.resolve(true)),
        setAuthorName: vi.fn(() => Promise.resolve(true)),
        ...overrides,
    } as unknown as VersionSurface;
    render(<ServerPickerDialog surface={surface} isOpen onClose={onClose} />);
    return { onClose, surface };
}

/**
 * The dialog's own primary button, which is in the modal's footer rather than its body.
 *
 * Found by its seam rather than by its words, because the words are the point: it says
 * "Connect" for a server that already holds this project and "Create and send" for one that
 * has never seen it, and a helper keyed on one of those would silently stop finding the other.
 */
function connectButton(): HTMLElement {
    const button = document.querySelector<HTMLElement>("[data-vcs-seam='picker-connect']") ?? undefined;
    if (button === undefined) throw new Error("no Connect button on screen");
    return button;
}

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

/** What the overflow menu offers, in the order it offers it. Separators read as nothing. */
function menuRows(): string[] {
    const menu = document.querySelector("[data-context-menu='true']");
    if (menu === null) return [];
    return [...menu.children].map(row => row.textContent ?? "").filter(text => text !== "");
}

/** The rows, in the order they are drawn, so "at the end of the list" is a real assertion. */
function rows(): string[] {
    return [...document.querySelectorAll("[data-server-choice], [data-vcs-seam='picker-add']")]
        .map(node => node.getAttribute("data-server-choice") ?? "add");
}

describe("the server picker", () => {
    it("offers adding a server as the last row of the list", async () => {
        bridge.servers = [session(ONE, "ada"), session(TWO, "bea")];
        picker(null);

        await waitFor(() => expect(rows()).toEqual([ONE, TWO, "add"]));
    });

    it("offers it where nothing has been added, which is the case it is most needed in", async () => {
        picker(null);

        await waitFor(() => expect(rows()).toEqual(["add"]));
        expect(document.querySelector("[data-vcs-seam='server-picker']")?.textContent)
            .toContain("workspace.shell.versionControl.server.picker.empty");
    });

    it("opens Settings at the servers panel and closes, rather than asking for a token here", async () => {
        const { onClose } = picker(null);
        await waitFor(() => expect(document.querySelector("[data-vcs-seam='picker-add']")).not.toBeNull());

        fireEvent.click(document.querySelector("[data-vcs-seam='picker-add']")!);

        expect(bridge.launchSettings).toHaveBeenCalledWith({ highlight: SERVERS_PANEL_SETTING_KEY });
        expect(onClose).toHaveBeenCalled();
    });

    it("calls a server by the name it gave, with its address still under it", async () => {
        bridge.servers = [session(ONE, "ada", "Blackwood Studio")];
        picker(null);

        await waitFor(() => expect(document.querySelector(`[data-server-choice='${ONE}']`)).not.toBeNull());

        const row = document.querySelector(`[data-server-choice='${ONE}']`)!;
        expect(row.textContent).toContain("Blackwood Studio");
        // The address is what this project's remote is written against, so choosing between
        // two deployments of one name is still possible.
        expect(row.textContent).toContain("one.example.lan:41337");
    });

    it("opens with nothing chosen for a project that uses no server", async () => {
        bridge.servers = [session(ONE, "ada")];
        picker(null);

        await waitFor(() => expect(document.querySelector(`[data-server-choice='${ONE}']`)).not.toBeNull());
        expect(document.querySelector("[aria-pressed='true']")).toBeNull();
        // The name field belongs to a chosen server, and the address field to the option below
        // the add row; neither has been asked for yet.
        expect(document.querySelectorAll("input")).toHaveLength(0);
    });

    it("opens on the server the project already uses, with the name it has there", async () => {
        bridge.servers = [session(ONE, "ada"), session(TWO, "bea")];
        picker(`${TWO}/my-game`);

        await waitFor(() => expect(document.querySelector(`[data-server-choice='${TWO}']`)?.getAttribute("aria-pressed"))
            .toBe("true"));
        expect(document.querySelector<HTMLInputElement>("input")?.value).toBe("my-game");
    });

    it("keeps the address field, below the add row, for a server nobody signs in to", async () => {
        bridge.servers = [session(ONE, "ada")];
        picker("lore://plain.example.lan:41337/my-game");

        const body = await waitFor(() => document.querySelector("[data-vcs-seam='server-picker']")!);
        const nodes = [...body.querySelectorAll("[data-vcs-seam='picker-add'], [data-vcs-seam='picker-address']")];
        expect(nodes.map(node => node.getAttribute("data-vcs-seam"))).toEqual(["picker-add", "picker-address"]);
        // Opened on it, with the address in it: this is the one place a project pointed at a
        // bare server can read or change where its work goes.
        expect(document.querySelector<HTMLInputElement>("input")?.value)
            .toBe("lore://plain.example.lan:41337/my-game");
    });
});

/**
 * What Connect does, which is not the same act for the two kinds of destination.
 *
 * A server out of the list has an API of its own: it can be asked to record this
 * project, which is the step that makes the work reachable by anybody else. Connecting
 * without it is the state this whole dialog used to leave behind - a project that pushes
 * from the one machine that set it up and cannot be cloned from any other.
 *
 * A typed address is a bare `loreserver` with nothing in front of it. There is nothing
 * to record it in, so it keeps what it always had.
 */
describe("what Connect does", () => {
    it("puts the project on a server chosen from the list, rather than only pointing at it", async () => {
        bridge.servers = [session(ONE, "ada")];
        const { onClose, surface } = picker(null);

        await waitFor(() => expect(document.querySelector(`[data-server-choice='${ONE}']`)).not.toBeNull());
        fireEvent.click(document.querySelector(`[data-server-choice='${ONE}']`)!);
        // The name field is drawn once the server has said what it holds: whether this
        // project is already one of them is what decides that there is a name to ask for.
        await waitFor(() => expect(document.querySelector("[data-vcs-seam='picker-destination'] input")).not.toBeNull());
        fireEvent.change(document.querySelector("[data-vcs-seam='picker-destination'] input")!, {
            target: { value: "driftwood" },
        });
        fireEvent.click(connectButton());

        expect(surface.publish).toHaveBeenCalledWith(ONE, "driftwood");
        expect(surface.setRemote).not.toHaveBeenCalled();
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    /**
     * What this project becomes on the server, which is the question the dialog never asked.
     *
     * Choosing a server used to be the whole of it, and what the project was called there was
     * a text box seeded from the folder name. Two acts hid behind that box: a name nobody had
     * used made a project and sent it, and a name somebody had used was refused after the
     * dialog had closed. Neither was said out loud before the button was pressed.
     */
    describe("what this project is on that server", () => {
        const REPOSITORY = "019fda5ba4fe799096aaab7585aa4722";

        function held(origin: string, projects: { id: string; name: string }[]) {
            bridge.projects[origin] = projects.map(entry => ({
                ...entry, description: "", createdAt: 0, remote: `${origin}/${entry.name}`,
            }));
        }

        it("states the name a server already holds this project under, and points at that", async () => {
            bridge.servers = [session(ONE, "ada")];
            // A colleague published it, or this author did from another machine. The folder
            // here is called something else entirely, which is the case a name match breaks.
            held(ONE, [{ id: REPOSITORY, name: "driftwood" }]);
            const { surface } = picker(null, { repositoryId: REPOSITORY });

            await waitFor(() => expect(document.querySelector(`[data-server-choice='${ONE}']`)).not.toBeNull());
            fireEvent.click(document.querySelector(`[data-server-choice='${ONE}']`)!);

            // The name itself rides in the sentence's parameter, which this file's translator
            // stub drops; what is asserted here is that the sentence is the one that names it,
            // and the name it carries is asserted on the call below.
            await waitFor(() => expect(seam("picker-already").textContent)
                .toContain("workspace.shell.versionControl.server.picker.already"));
            // Nothing left to decide, so nothing to type.
            expect(document.querySelector("[data-vcs-seam='picker-destination'] input")).toBeNull();

            fireEvent.click(connectButton());
            // The server's own name for it. The folder name would be an address that server
            // does not answer to, and nothing downstream would correct it.
            expect(surface.publish).toHaveBeenCalledWith(ONE, "driftwood");
        });

        it("matches on the repository id and never on the name", async () => {
            bridge.servers = [session(ONE, "ada")];
            // Same name, different work: the case that would hand this project to somebody
            // else's repository.
            held(ONE, [{ id: "ffffffffffffffffffffffffffffffff", name: "driftwood" }]);
            picker(null, { repositoryId: REPOSITORY });

            await waitFor(() => expect(document.querySelector(`[data-server-choice='${ONE}']`)).not.toBeNull());
            fireEvent.click(document.querySelector(`[data-server-choice='${ONE}']`)!);

            await waitFor(() => expect(document.querySelector("[data-vcs-seam='picker-destination'] input")).not.toBeNull());
            expect(document.querySelector("[data-vcs-seam='picker-already']")).toBeNull();
        });

        it("refuses a name that server already has, before anything is sent", async () => {
            bridge.servers = [session(ONE, "ada")];
            held(ONE, [{ id: "ffffffffffffffffffffffffffffffff", name: "driftwood" }]);
            const { surface } = picker(null, { repositoryId: REPOSITORY });

            await waitFor(() => expect(document.querySelector(`[data-server-choice='${ONE}']`)).not.toBeNull());
            fireEvent.click(document.querySelector(`[data-server-choice='${ONE}']`)!);
            await waitFor(() => expect(document.querySelector("[data-vcs-seam='picker-destination'] input")).not.toBeNull());
            fireEvent.change(document.querySelector("[data-vcs-seam='picker-destination'] input")!, {
                target: { value: "Driftwood" },
            });

            await waitFor(() => expect(seam("picker-destination").textContent)
                .toContain("workspace.shell.versionControl.server.picker.nameTaken"));
            expect((connectButton() as HTMLButtonElement).disabled).toBe(true);
            fireEvent.click(connectButton());
            expect(surface.publish).not.toHaveBeenCalled();
        });

        it("refuses a name an address cannot carry", async () => {
            bridge.servers = [session(ONE, "ada")];
            held(ONE, []);
            const { surface } = picker(null, { repositoryId: REPOSITORY });

            await waitFor(() => expect(document.querySelector(`[data-server-choice='${ONE}']`)).not.toBeNull());
            fireEvent.click(document.querySelector(`[data-server-choice='${ONE}']`)!);
            await waitFor(() => expect(document.querySelector("[data-vcs-seam='picker-destination'] input")).not.toBeNull());
            fireEvent.change(document.querySelector("[data-vcs-seam='picker-destination'] input")!, {
                target: { value: "My Game" },
            });

            await waitFor(() => expect(seam("picker-destination").textContent)
                .toContain("workspace.shell.versionControl.server.picker.nameInvalid"));
            expect((connectButton() as HTMLButtonElement).disabled).toBe(true);
            fireEvent.click(connectButton());
            expect(surface.publish).not.toHaveBeenCalled();
        });

        it("still asks for a name where the list could not be read", async () => {
            bridge.servers = [session(ONE, "ada")];
            // The list is there to help. A server that would not answer is not a reason to
            // refuse to connect - it is a reason to ask the way this dialog always asked.
            bridge.listServerProjects.mockResolvedValue({ success: true, data: { ok: false, problem: { kind: "unreachable" } } });
            const { surface } = picker(null, { repositoryId: REPOSITORY });

            await waitFor(() => expect(document.querySelector(`[data-server-choice='${ONE}']`)).not.toBeNull());
            fireEvent.click(document.querySelector(`[data-server-choice='${ONE}']`)!);
            await waitFor(() => expect(document.querySelector("[data-vcs-seam='picker-destination'] input")).not.toBeNull());
            fireEvent.change(document.querySelector("[data-vcs-seam='picker-destination'] input")!, {
                target: { value: "driftwood" },
            });
            fireEvent.click(connectButton());

            expect(surface.publish).toHaveBeenCalledWith(ONE, "driftwood");
        });
    });

    it("writes the address alone for a server nobody signs in to, because there is nothing to ask", async () => {
        bridge.servers = [session(ONE, "ada")];
        const { surface } = picker(null);

        await waitFor(() => expect(document.querySelector("[data-vcs-seam='picker-address']")).not.toBeNull());
        fireEvent.click(seam("picker-address").querySelector("button")!);
        fireEvent.change(document.querySelector("input")!, {
            target: { value: "lore://plain.example.lan:41337/my-game" },
        });
        fireEvent.click(connectButton());

        expect(surface.setRemote).toHaveBeenCalledWith("lore://plain.example.lan:41337/my-game");
        expect(surface.publish).not.toHaveBeenCalled();
    });

    it("stays open on a publish that did not go through, so the reason can be read", async () => {
        bridge.servers = [session(ONE, "ada")];
        const { onClose } = picker(null, {
            publish: vi.fn(() => Promise.resolve(false)),
            failure: { text: "workspace.shell.versionControl.server.publish.refused", tone: "failure" },
        });

        await waitFor(() => expect(document.querySelector(`[data-server-choice='${ONE}']`)).not.toBeNull());
        fireEvent.click(document.querySelector(`[data-server-choice='${ONE}']`)!);
        await waitFor(() => expect(document.querySelector("[data-vcs-seam='picker-destination'] input")).not.toBeNull());
        fireEvent.change(document.querySelector("[data-vcs-seam='picker-destination'] input")!, {
            target: { value: "driftwood" },
        });
        fireEvent.click(connectButton());

        await waitFor(() => expect(seam("picker-failure").textContent)
            .toContain("workspace.shell.versionControl.server.publish.refused"));
        expect(onClose).not.toHaveBeenCalled();
    });
});

/**
 * Who the versions are by, asked only where nothing else will answer it.
 *
 * A server out of the list has a session, and the recorded author then comes from that session's
 * account - `VcsManager.resolveIdentity` prefers it, keyed on the project's own remote origin. So
 * the question drawn beside a chosen server is one whose answer is thrown away moments later, asked
 * at the exact moment it looks most relevant. It survives for the address field, where a bare
 * server issues no token and records whatever it is told.
 */
describe("the author name in the server picker", () => {
    it("is not asked for a server out of the list", async () => {
        bridge.servers = [session(ONE, "ada")];
        picker(null, { authorName: null });

        await waitFor(() => expect(document.querySelector(`[data-server-choice='${ONE}']`)).not.toBeNull());
        // Nothing chosen yet is not a destination either, so it is absent here too.
        expect(document.querySelector("[data-vcs-seam='author-identity']")).toBeNull();

        fireEvent.click(document.querySelector(`[data-server-choice='${ONE}']`)!);

        expect(document.querySelector(`[data-server-choice='${ONE}']`)?.getAttribute("aria-pressed")).toBe("true");
        expect(document.querySelector("[data-vcs-seam='author-identity']")).toBeNull();
    });

    it("is asked for an address the list cannot account for", async () => {
        bridge.servers = [session(ONE, "ada")];
        picker(null, { authorName: null });

        await waitFor(() => expect(document.querySelector("[data-vcs-seam='picker-address']")).not.toBeNull());
        fireEvent.click(seam("picker-address").querySelector("button")!);

        expect(document.querySelector("[data-vcs-seam='author-identity']")).not.toBeNull();

        // And it goes again the moment the destination is one that answers for itself.
        fireEvent.click(document.querySelector(`[data-server-choice='${ONE}']`)!);
        expect(document.querySelector("[data-vcs-seam='author-identity']")).toBeNull();
    });

    it("stays out of the way once the name has been answered", async () => {
        bridge.servers = [session(ONE, "ada")];
        picker(null);

        await waitFor(() => expect(document.querySelector("[data-vcs-seam='picker-address']")).not.toBeNull());
        fireEvent.click(seam("picker-address").querySelector("button")!);

        expect(document.querySelector("[data-vcs-seam='author-identity']")).toBeNull();
    });
});

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
 * Send and Get are pressed every working day; choosing a server is decided about once per project.
 * The section used to give them the same weight - the host line WAS the control that opened the
 * change-server dialog, one line above Send - so the whole point of the suite is that the rare acts
 * stay behind the menu and the daily two stay a press away, at full size, on one row.
 */
describe("the rail's server section", () => {
    it("holds exactly the rare acts in its overflow menu", () => {
        section();

        expect(menuRows()).toEqual([]);
        fireEvent.click(seam("server-menu"));

        expect(menuRows()).toEqual([
            "workspace.shell.versionControl.server.check",
            "workspace.shell.versionControl.server.change",
            "workspace.shell.versionControl.server.disconnect",
        ]);
    });

    it("keeps sending and getting a press away, at full width, with no menu in between", () => {
        const surface = section();

        expect(document.querySelector("[data-context-menu='true']")).toBeNull();
        fireEvent.click(seam("server-push"));
        fireEvent.click(seam("server-sync"));

        expect(surface.pushToRemote).toHaveBeenCalledTimes(1);
        expect(surface.syncFromRemote).toHaveBeenCalledTimes(1);
        // Both on the control scale's `sm` step and sharing the row equally: the menu was added
        // above them, not squeezed in beside them, and this is what says so.
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

    it("reaches the change-server dialog from the menu, and from nowhere in front of it", () => {
        section();

        // The line that names the server is a line. It used to be the button that covered the
        // rail with this dialog, which is the regression this pins.
        expect(seam("server-name").tagName).toBe("SPAN");
        expect(document.querySelector("[data-vcs-seam='server-picker']")).toBeNull();

        fireEvent.click(seam("server-menu"));
        fireEvent.click([...document.querySelectorAll("[data-context-menu='true'] > div")]
            .find(row => row.textContent === "workspace.shell.versionControl.server.change")!);

        expect(document.querySelector("[data-vcs-seam='server-picker']")).not.toBeNull();
    });

    it("asks the server where things stand from the menu", () => {
        const surface = section();

        fireEvent.click(seam("server-menu"));
        fireEvent.click([...document.querySelectorAll("[data-context-menu='true'] > div")]
            .find(row => row.textContent === "workspace.shell.versionControl.server.check")!);

        expect(surface.checkRemote).toHaveBeenCalledTimes(1);
    });

    it("disconnects from the menu", () => {
        const surface = section();

        fireEvent.click(seam("server-menu"));
        fireEvent.click([...document.querySelectorAll("[data-context-menu='true'] > div")]
            .find(row => row.textContent === "workspace.shell.versionControl.server.disconnect")!);

        expect(surface.setRemote).toHaveBeenCalledWith(null);
    });
});
