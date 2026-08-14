// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVERS_PANEL_SETTING_KEY } from "@shared/constants/servers";
import type { VcsServerSession } from "@shared/types/vcs";
import { ServerPickerDialog } from "./VersionRail";
import type { VersionSurface } from "../../hooks/useVersionSurface";

/**
 * The dialog picks a server. It does not describe one and it does not add one.
 *
 * Adding is a Settings act - a token signs the whole installation in - so the last row of the
 * list opens Settings there and this dialog closes. The three things that regress are pinned
 * below, because each of them reads as a convenience while it is being written: an address
 * being preselected for a project that has no server, the add row drifting away from the list
 * it belongs to, and pressing it leaving this dialog up over a list it will not re-read.
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
    launchSettings: vi.fn(),
}));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        vcs: { listServers: () => Promise.resolve({ success: true, data: { servers: bridge.servers } }) },
        app: { launchSettings: bridge.launchSettings },
    }),
}));

afterEach(() => {
    cleanup();
    bridge.servers = [];
    bridge.launchSettings.mockClear();
});

function session(origin: string, displayName: string): VcsServerSession {
    return {
        remoteOrigin: origin,
        authUrl: `https://${displayName}.example.lan`,
        account: { userId: displayName, username: displayName, displayName, identity: displayName },
    } as VcsServerSession;
}

const ONE = "lore://one.example.lan:41337";
const TWO = "lore://two.example.lan:41337";

function picker(remote: string | null) {
    const onClose = vi.fn();
    const surface = {
        // Absent, so the author-name offer above the list stays out of the way of these cases.
        authorName: "Ada Blackwood",
        busy: null,
        failure: null,
        remote,
        remoteNeedsSignIn: false,
        setRemote: vi.fn(() => Promise.resolve(true)),
    } as unknown as VersionSurface;
    render(<ServerPickerDialog surface={surface} isOpen onClose={onClose} />);
    return { onClose, surface };
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
