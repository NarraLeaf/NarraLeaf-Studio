// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VcsServerSession } from "@shared/types/vcs";
import { CommitForm, ServerPickerDialog, ServerSection } from "./VersionRail";
import { registerTeamPresenceBridge } from "../../modules/team/teamPresenceController";
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
 * Get a press away, the server line reading as a line, and everything that CHANGES the destination
 * living in the Team panel rather than creeping back into the column beside them.
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
            // The add sequence is mounted from the last row of the list now. Nothing here
            // reaches for these until it is pressed, so a stub is enough to keep it honest.
            probeServer: () => Promise.resolve({ success: false }),
            addServer: () => Promise.resolve({ success: false }),
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

    it("runs the add sequence here rather than sending the reader to another window", async () => {
        const { onClose } = picker(null);
        await waitFor(() => expect(document.querySelector("[data-vcs-seam='picker-add']")).not.toBeNull());

        fireEvent.click(document.querySelector("[data-vcs-seam='picker-add']")!);

        // The same sequence Settings mounts, over the top of this dialog. It used to open
        // Settings in another window and close this one, which lost the project being connected.
        expect(document.querySelector("[data-servers-seam='wizard-step-1']")).not.toBeNull();
        expect(bridge.launchSettings).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
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
        // The name field belongs to a chosen server, and nothing has been chosen yet.
        expect(document.querySelectorAll("input")).toHaveLength(0);
    });

    it("opens on the server the project already uses, with the name it has there", async () => {
        bridge.servers = [session(ONE, "ada"), session(TWO, "bea")];
        picker(`${TWO}/my-game`);

        await waitFor(() => expect(document.querySelector(`[data-server-choice='${TWO}']`)?.getAttribute("aria-pressed"))
            .toBe("true"));
        expect(document.querySelector<HTMLInputElement>("input")?.value).toBe("my-game");
    });

    it("names the server a project uses that this machine has no account on", async () => {
        bridge.servers = [session(ONE, "ada")];
        picker("lore://plain.example.lan:41337/my-game");

        await waitFor(() => expect(document.querySelector("[data-vcs-seam='picker-unknown']")).not.toBeNull());
        // A statement with the host in it, and the add row underneath. It used to be an address
        // field opened with the address already in it, which reads as an invitation to retype
        // the one thing that was never wrong.
        expect(document.querySelector("[data-vcs-seam='picker-address']")).toBeNull();
        expect(document.querySelectorAll("input")).toHaveLength(0);
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
 * There is only the one kind now. A typed address wrote a remote and nothing else, which is
 * what a `loreserver` with nothing in front of it could be given, and that field is gone.
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
 * Who the versions are by, which this dialog no longer asks at all.
 *
 * Every destination it can offer is a Team server this machine has an account on, and the recorded
 * author then comes from that account - `VcsManager.resolveIdentity` prefers it, keyed on the
 * project's own remote origin. So a name typed here is one thrown away moments later, asked at the
 * exact moment it looks most relevant. It used to survive for the address field, where a bare
 * server recorded whatever it was told; there is no address field any more.
 */
describe("the author name in the server picker", () => {
    it("is never asked here, chosen server or not", async () => {
        bridge.servers = [session(ONE, "ada")];
        picker(null, { authorName: null });

        await waitFor(() => expect(document.querySelector(`[data-server-choice='${ONE}']`)).not.toBeNull());
        expect(document.querySelector("[data-vcs-seam='author-identity']")).toBeNull();

        fireEvent.click(document.querySelector(`[data-server-choice='${ONE}']`)!);

        expect(document.querySelector(`[data-server-choice='${ONE}']`)?.getAttribute("aria-pressed")).toBe("true");
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

    it("sends a project on no server to the panel that owns the question", () => {
        const open = vi.fn();
        const forget = registerTeamPresenceBridge({ open });
        section({ remote: null });

        fireEvent.click(seam("server-connect"));

        // The dialog is opened by the Team panel, not from here: one door to a decision made once
        // per project, and it is the same door it is changed through afterwards.
        expect(open).toHaveBeenCalledTimes(1);
        expect(document.querySelector("[data-vcs-seam='server-picker']")).toBeNull();
        forget();
    });
});
