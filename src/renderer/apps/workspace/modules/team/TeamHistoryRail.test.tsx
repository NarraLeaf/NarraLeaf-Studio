// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamHistoryRail, type TeamDocumentsSurface } from "./TeamHistoryRail";

const history = vi.hoisted(() => ({
    refresh: vi.fn(),
    saveVersion: vi.fn(),
    list: vi.fn(),
    page: { revisions: [], more: false } as { revisions?: unknown[]; more: boolean } | null,
}));

vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/team/useTeam", () => ({
    useTeamTopics: () => ({ value: history.page, refresh: history.refresh }),
    useTeamConnection: () => ({ remoteOrigin: "team" }),
    useTeamCapability: () => false,
}));
vi.mock("@/lib/team/teamCall", () => ({ listProjectHistory: history.list }));
vi.mock("../../context", () => ({ useWorkspace: () => ({ context: null }), useOptionalWorkspace: () => null }));
vi.mock("@/lib/components/elements/Modal", () => ({ Modal: () => null }));
vi.mock("@/lib/vcs/DocumentChangeList", () => ({ DocumentChangeList: () => null }));

function surface(previewing: string | null = null): TeamDocumentsSurface {
    return {
        view: { state: "online", seq: 0, mayEdit: true, conflicts: [] },
        target: { remoteOrigin: "team", project: "p1" },
        service: { saveVersion: history.saveVersion } as unknown as TeamDocumentsSurface["service"],
        previewing,
        detached: null,
    };
}

beforeEach(() => {
    history.saveVersion.mockReset();
    history.refresh.mockClear();
    history.list.mockReset();
    history.page = { revisions: [], more: false };
});
afterEach(cleanup);

describe("team history", () => {
    it("keeps a version name when the server refuses to save it", async () => {
        history.saveVersion.mockResolvedValue({ ok: false, problem: { detail: "offline" } });
        render(<TeamHistoryRail surface={surface()} collapsed={false} onCollapsedChange={() => undefined} />);
        const input = screen.getByPlaceholderText("workspace.shell.team.docs.versionLabel") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "Release candidate" } });
        fireEvent.click(screen.getByText("workspace.shell.team.docs.saveVersion"));
        await waitFor(() => expect(history.saveVersion).toHaveBeenCalledWith("Release candidate"));
        await waitFor(() => expect(input.value).toBe("Release candidate"));
        expect(history.refresh).not.toHaveBeenCalled();
        expect(screen.getByRole("alert").textContent).toBe("workspace.shell.statusBar.saveFailed");
    });

    it("clears the name and refreshes after a saved version", async () => {
        history.saveVersion.mockResolvedValue({ ok: true, value: {} });
        render(<TeamHistoryRail surface={surface()} collapsed={false} onCollapsedChange={() => undefined} />);
        const input = screen.getByPlaceholderText("workspace.shell.team.docs.versionLabel") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "Release candidate" } });
        fireEvent.click(screen.getByText("workspace.shell.team.docs.saveVersion"));
        await waitFor(() => expect(input.value).toBe(""));
        expect(history.refresh).toHaveBeenCalledTimes(1);
    });

    it("uses the configured accent for the preview indicator", () => {
        const view = render(<TeamHistoryRail surface={surface("version-1")} collapsed={false} onCollapsedChange={() => undefined} />);
        expect(view.container.querySelector("[data-team-docs-previewing]")?.className).toContain("bg-primary/10");
    });

    it("does not call the history empty before the server has supplied a list", () => {
        history.page = null;
        const view = render(<TeamHistoryRail surface={surface()} collapsed={false} onCollapsedChange={() => undefined} />);
        expect(screen.queryByText("workspace.shell.team.docs.noVersions")).toBeNull();
        history.page = { more: false };
        view.rerender(<TeamHistoryRail surface={surface()} collapsed={false} onCollapsedChange={() => undefined} />);
        expect(screen.queryByText("workspace.shell.team.docs.noVersions")).toBeNull();
        history.page = { revisions: [], more: false };
        view.rerender(<TeamHistoryRail surface={surface()} collapsed={false} onCollapsedChange={() => undefined} />);
        expect(screen.getByText("workspace.shell.team.docs.noVersions")).toBeTruthy();
    });

    it("discards an older page fetched for a superseded first page", async () => {
        let finishPage!: (value: unknown) => void;
        history.list.mockReturnValue(new Promise(resolve => { finishPage = resolve; }));
        history.page = { revisions: [{ id: "v3", message: "Three" }, { id: "v2", message: "Two" }], more: true };
        const view = render(<TeamHistoryRail surface={surface()} collapsed={false} onCollapsedChange={() => undefined} />);
        fireEvent.click(screen.getByText("workspace.shell.team.docs.loadMore"));
        history.page = { revisions: [{ id: "v4", message: "Four" }, { id: "v3", message: "Three" }], more: true };
        view.rerender(<TeamHistoryRail surface={surface()} collapsed={false} onCollapsedChange={() => undefined} />);
        await act(async () => { finishPage({ ok: true, value: { revisions: [{ id: "v1", message: "One" }], more: false } }); });
        expect(screen.queryByText("One")).toBeNull();
        expect(screen.getByText("workspace.shell.team.docs.loadMore")).toBeTruthy();
    });

});
