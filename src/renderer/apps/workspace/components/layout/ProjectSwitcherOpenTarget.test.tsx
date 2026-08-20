// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSwitcher } from "./ProjectSwitcher";
import type { VersionSurface } from "../../hooks/useVersionSurface";

/**
 * Which window a picked project opens in - and when that is not a question at all.
 *
 * A project that already has a window is focused by both answers (the main-process
 * `App.openProject`), and the answer that reads as a switch would additionally close the project
 * this window is holding. So the dialog is for projects that are about to be opened, and the two
 * ways that regresses are pinned below: the question coming back for a project that is already on
 * screen, and the shortcut spreading to projects that are not.
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

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({
        context: {
            project: { getConfig: () => ({ projectPath: "D:/games/here" }) },
            services: { get: () => ({ getProjectConfig: () => ({ name: "Here" }) }) },
        },
    }),
}));

const ELSEWHERE = "D:/games/elsewhere";

const recents = vi.hoisted(() => ({ openRecent: vi.fn() }));
vi.mock("../../hooks/useRecentProjects", () => ({
    useRecentProjects: () => [
        { name: "Elsewhere", path: "D:/games/elsewhere", lastOpened: 0 },
        { name: "Here", path: "D:/games/here", lastOpened: 0 },
    ],
    useOpenRecentProject: () => recents.openRecent,
}));

const bridge = vi.hoisted(() => ({
    open: false,
    isProjectOpen: vi.fn(),
    launch: vi.fn(),
}));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        workspace: { isProjectOpen: bridge.isProjectOpen, launch: bridge.launch },
    }),
}));

beforeEach(() => {
    bridge.isProjectOpen.mockImplementation(() => Promise.resolve({ success: true, data: { open: bridge.open } }));
});

afterEach(() => {
    cleanup();
    bridge.open = false;
    bridge.isProjectOpen.mockClear();
    bridge.launch.mockClear();
    recents.openRecent.mockClear();
});

/** Version control is not what these cases are about; this state draws none of its section. */
const NO_VERSION_CONTROL = {
    state: { kind: "unavailable", reason: "unsupported-platform" },
    branch: null,
    frozen: null,
    busy: null,
} as unknown as VersionSurface;

/** Open the menu and pick the one project that is not this window's. */
function pickElsewhere() {
    render(<ProjectSwitcher versionSurface={NO_VERSION_CONTROL} />);
    fireEvent.click(screen.getByRole("button", { name: /Here/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Elsewhere/ }));
}

/** The dialog, by its title, or null while it is not up. */
function dialog(): HTMLElement | null {
    return screen.queryByText("workspace.shell.projectSwitcher.openTarget.title");
}

describe("picking a project in the switcher", () => {
    it("goes straight to a project that already has a window, without asking which one", async () => {
        bridge.open = true;
        pickElsewhere();

        await waitFor(() => expect(recents.openRecent).toHaveBeenCalledWith(ELSEWHERE, { replaceCurrentWindow: false }));
        expect(bridge.isProjectOpen).toHaveBeenCalledWith(ELSEWHERE);
        // Asking would be a question with one outcome, and the answer that closes this window
        // would trade a working project for one that was already open.
        expect(dialog()).toBeNull();
    });

    it("asks where to open a project that has no window yet", async () => {
        pickElsewhere();

        await waitFor(() => expect(dialog()).not.toBeNull());
        expect(recents.openRecent).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText("workspace.shell.projectSwitcher.openTarget.thisWindow"));
        expect(recents.openRecent).toHaveBeenCalledWith(ELSEWHERE, { replaceCurrentWindow: true });
    });

    it("asks when the question cannot be answered, rather than deciding on its own", async () => {
        bridge.isProjectOpen.mockImplementation(() => Promise.resolve({ success: false, error: "no answer" }));
        pickElsewhere();

        await waitFor(() => expect(dialog()).not.toBeNull());
        expect(recents.openRecent).not.toHaveBeenCalled();
    });
});
