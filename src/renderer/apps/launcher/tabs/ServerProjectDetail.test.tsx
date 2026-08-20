// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
    VcsServerProject,
    VcsServerProjectDetail,
    VcsServerProjectHistoryPage,
} from "@shared/types/vcs";
import { ServerProjectDetailView } from "./ServerProjectDetail";

/**
 * What one project draws when the server knows nothing about it.
 *
 * This is not the edge case. A server records a project when it is created and reads its
 * repository afterwards, and on a deployment whose reader is not working it never gets to
 * the second half - so `readable: false` with an empty history is the state most of these
 * panels are looked at in. Everything that could be invented from it is asserted absent
 * here: a zero, an epoch date, and an empty list presented as a fact about somebody's work.
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

const bridge = vi.hoisted(() => ({
    getServerProject: vi.fn(),
    listServerProjectHistory: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        vcs: {
            getServerProject: bridge.getServerProject,
            listServerProjectHistory: bridge.listServerProjectHistory,
        },
    }),
}));

const ORIGIN = "lore://team.example.lan:41337";
const PROJECT_ID = "019fda5ba4fe799096aaab7585aa4722";

function project(overrides: Partial<VcsServerProject> = {}): VcsServerProject {
    return {
        id: PROJECT_ID,
        name: "Moonlit",
        description: "A night on the water",
        createdAt: 0,
        remote: `${ORIGIN}/moonlit`,
        ...overrides,
    };
}

function detail(file: VcsServerProjectDetail["file"]): VcsServerProjectDetail {
    return { project: project(), file };
}

/** Draw the panel with whatever the two calls are set to answer. */
function open(options: {
    entry?: VcsServerProject;
    detail?: VcsServerProjectDetail | null;
    page?: VcsServerProjectHistoryPage | null;
    canDetail?: boolean;
    canHistory?: boolean;
    onBack?: () => void;
}) {
    bridge.getServerProject.mockResolvedValue(
        options.detail == null
            ? { success: true, data: { ok: false, problem: { kind: "unreachable" } } }
            : { success: true, data: { ok: true, detail: options.detail } },
    );
    bridge.listServerProjectHistory.mockResolvedValue(
        options.page == null
            ? { success: true, data: { ok: false, problem: { kind: "unreachable" } } }
            : { success: true, data: { ok: true, page: options.page } },
    );
    render(
        <ServerProjectDetailView
            remoteOrigin={ORIGIN}
            project={options.entry ?? project()}
            canDetail={options.canDetail ?? true}
            canHistory={options.canHistory ?? true}
            action={<button type="button" data-project-action="get">get</button>}
            onBack={options.onBack ?? (() => undefined)}
        />,
    );
}

function panel(): string {
    return document.querySelector(`[data-server-project-detail='${PROJECT_ID}']`)?.textContent ?? "";
}

afterEach(() => {
    cleanup();
    bridge.getServerProject.mockReset();
    bridge.listServerProjectHistory.mockReset();
});

describe("a project the server has not read", () => {
    it("says so once, and invents nothing about the work", async () => {
        // The shape a real deployment sends today, both halves of it.
        open({
            entry: project({ history: {} }),
            detail: detail({ readable: false }),
            page: { more: false },
        });

        await waitFor(() => expect(document.querySelector("[data-project-unread]")).not.toBeNull());
        expect(document.querySelectorAll("[data-project-unread]")).toHaveLength(1);
        expect(panel()).toContain("launcher.servers.detail.unread");
        // What the panel still knows is what the list already carried.
        expect(panel()).toContain("Moonlit");
        expect(panel()).toContain("A night on the water");
        // And the four ways an absence turns into a claim.
        expect(panel()).not.toContain("1970");
        expect(panel()).not.toContain("launcher.servers.detail.scenes");
        expect(panel()).not.toContain("launcher.servers.detail.noVersions");
        expect(document.querySelector("[data-project-versions]")).toBeNull();
    });

    it("does not repeat the sentence the server wrote for its own operator", async () => {
        open({ detail: detail({ readable: false }), page: { more: false } });

        await waitFor(() => expect(document.querySelector("[data-project-unread]")).not.toBeNull());
        // Nothing from the backend reaches this panel: the outcome carries `readable`
        // alone, so there is no English sentence here to leak into another language.
        expect(panel()).not.toMatch(/reader|store|repository/i);
    });

    it("keeps the project's own action reachable from here", async () => {
        open({ detail: detail({ readable: false }), page: { more: false } });

        await waitFor(() => expect(document.querySelector("[data-project-action='get']")).not.toBeNull());
    });

    it("goes back to the list", async () => {
        const back = vi.fn();
        open({ detail: detail({ readable: false }), page: { more: false }, onBack: back });

        fireEvent.click(document.querySelector("[data-project-action='back']")!);
        expect(back).toHaveBeenCalled();
    });
});

describe("a project the server has read", () => {
    it("draws the counts it gave and leaves out the ones it did not", async () => {
        open({
            detail: detail({ readable: true, title: "Moonlit Bay", stageWidth: 1920, stageHeight: 1080, scenes: 12 }),
            page: { revisions: [], more: false },
        });

        await waitFor(() => expect(panel()).toContain("launcher.servers.detail.scenes"));
        expect(panel()).toContain("Moonlit Bay");
        expect(panel()).toContain("1920×1080");
        expect(panel()).toContain("12");
        expect(panel()).not.toContain("launcher.servers.detail.assets");
        expect(document.querySelector("[data-project-unread]")).toBeNull();
    });

    it("says a read project has no versions, which an unread one is never told to say", async () => {
        open({ detail: detail({ readable: true }), page: { revisions: [], more: false } });

        await waitFor(() => expect(panel()).toContain("launcher.servers.detail.noVersions"));
        expect(document.querySelector("[data-project-unread]")).toBeNull();
    });

    it("lists the versions, and says there are older ones", async () => {
        open({
            detail: detail({ readable: true }),
            page: {
                revisions: [
                    { id: "a1b2c3d4e5", at: Date.UTC(2026, 7, 20), by: "Ada Lovelace", message: "Chapter two" },
                    { id: "f6a7b8c9d0" },
                ],
                more: true,
            },
        });

        await waitFor(() => expect(document.querySelectorAll("[data-project-revision]")).toHaveLength(2));
        expect(panel()).toContain("Chapter two");
        expect(panel()).toContain("Ada Lovelace");
        expect(panel()).toContain("2026-08-20");
        // A revision with nothing but an id still reads as something to refer to.
        expect(panel()).toContain("f6a7b8c");
        expect(panel()).toContain("launcher.servers.detail.olderVersions");
    });

    it("draws the last version from the list entry, and only where a time was given", async () => {
        open({
            entry: project({ history: { lastAt: Date.UTC(2026, 7, 20), lastBy: "Ada Lovelace" } }),
            detail: detail({ readable: true }),
            page: { revisions: [], more: false },
        });

        await waitFor(() => expect(panel()).toContain("launcher.servers.detail.lastVersion"));
        expect(panel()).toContain("2026-08-20");
        expect(panel()).toContain("Ada Lovelace");
    });
});

describe("what the server offers", () => {
    it("asks only for the history where that is all the server serves", async () => {
        open({
            canDetail: false,
            page: { revisions: [{ id: "a1b2c3d4e5", message: "Chapter two" }], more: false },
        });

        await waitFor(() => expect(panel()).toContain("Chapter two"));
        expect(bridge.getServerProject).not.toHaveBeenCalled();
        expect(bridge.listServerProjectHistory).toHaveBeenCalledWith(ORIGIN, PROJECT_ID);
        // Nothing was asked about the file, so nothing is said about it either way.
        expect(document.querySelector("[data-project-unread]")).toBeNull();
    });

    it("asks only about the project where the server serves no history", async () => {
        open({ canHistory: false, detail: detail({ readable: true, scenes: 3 }) });

        await waitFor(() => expect(panel()).toContain("launcher.servers.detail.scenes"));
        expect(bridge.listServerProjectHistory).not.toHaveBeenCalled();
        expect(document.querySelector("[data-project-versions]")).toBeNull();
    });

    it("puts a refusal in words and still draws what the list already knew", async () => {
        open({ detail: null, page: null });

        await waitFor(() => expect(panel()).toContain("launcher.servers.problem.unreachable"));
        expect(panel()).toContain("Moonlit");
        // One sentence, not two: the history failed for the same reason and says nothing.
        expect(panel().match(/launcher\.servers\.problem/g)).toHaveLength(1);
        expect(document.querySelector("[data-project-unread]")).toBeNull();
    });
});
