// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nStore } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { TeamDocView } from "@/lib/workspace/services/teamDocs/teamDocSync";
import { TeamHistoryRail, type TeamDocumentsSurface } from "./TeamHistoryRail";

const project = vi.hoisted(() => ({
    page: { revisions: [] as Array<{ id: string; message?: string; by?: string; at?: number }>, more: false },
    list: vi.fn(),
    compare: vi.fn(),
    preview: vi.fn(),
    override: vi.fn(),
    restore: vi.fn(),
    confirm: vi.fn(),
    readWorkingFile: vi.fn(),
    readRevisionDocuments: vi.fn(),
    storyDocument: vi.fn(),
    session: { remoteOrigin: "team", state: "ready", since: 1, capabilities: [], account: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", username: "ada", displayName: "Ada", operator: false } },
    context: { services: { get: vi.fn() } },
}));

vi.mock("@/lib/team/useTeam", () => ({
    useTeamTopics: () => ({ value: project.page, refresh: vi.fn() }),
    useTeamConnection: () => project.session,
}));
vi.mock("@/lib/team/teamCall", () => ({ listProjectHistory: project.list }));
vi.mock("../../context", () => ({
    useWorkspace: () => ({ context: project.context }),
    useOptionalWorkspace: () => ({ context: project.context }),
}));
vi.mock("@/lib/components/elements/Modal", () => ({
    Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => isOpen ? <div role="dialog">{children}</div> : null,
}));

const storyId = "11111111-1111-4111-8111-111111111111";
const missingStoryA = "22222222-2222-4222-8222-222222222222";
const missingStoryB = "33333333-3333-4333-8333-333333333333";
const sceneId = "44444444-4444-4444-8444-444444444444";
const blockId = "55555555-5555-4555-8555-555555555555";
const assetId = "f5e8519a-fdee-48e6-b064-51136de15c8e";
const assetPath = "assets/content/f5/e8/519afdee48e6b06451136de15c8e";
const revisionId = "66666666666646668666666666666666";
const storyPath = (id: string) => `editor/story/stories/${id}/storydoc.json`;
const scene = { name: "Arrival", blocks: { [blockId]: { id: blockId, kind: "nodeAction", payload: { action: "narration", text: { value: "Old line" } } } } };

function surface(conflicts: TeamDocView["conflicts"] = []): TeamDocumentsSurface {
    return {
        view: { state: "online", seq: 1, mayEdit: true, conflicts },
        target: { remoteOrigin: "team", project: "p1" },
        service: { compareWithCurrent: project.compare, overrideConflict: project.override, restoreVersion: project.restore, previewVersion: project.preview } as unknown as TeamDocumentsSurface["service"],
        previewing: null,
        detached: null,
    };
}

beforeEach(() => {
    project.page = { revisions: [], more: false };
    project.list.mockReset();
    project.compare.mockReset();
    project.preview.mockReset().mockResolvedValue(true);
    project.override.mockReset().mockResolvedValue(true);
    project.restore.mockReset().mockResolvedValue({ ok: true, value: null });
    project.confirm.mockReset().mockResolvedValue(true);
    project.readRevisionDocuments.mockReset();
    project.storyDocument.mockReset().mockReturnValue({ scenes: { [sceneId]: scene } });
    project.readWorkingFile.mockReset().mockImplementation(async (path: string) => {
        const files: Record<string, unknown> = {
            "editor/story/index.json": { stories: [{ id: storyId, name: "The Harbour" }] },
            "assets/assets.metadata.image.json": { [assetId]: { name: "Harbour artwork" } },
        };
        return files[path] === undefined ? null : new TextEncoder().encode(JSON.stringify(files[path]));
    });
    project.context.services.get.mockReset().mockImplementation((service: string) => {
        if (service === Services.VersionControl) return { readWorkingFile: project.readWorkingFile, readRevisionDocuments: project.readRevisionDocuments };
        if (service === Services.Story) return { getLoadedStoryDocument: project.storyDocument };
        if (service === Services.UI) return { showConfirm: project.confirm };
        throw new Error(`Unexpected service: ${service}`);
    });
});
afterEach(() => { cleanup(); i18nStore.setLocale("en"); });

describe("team history names", () => {
    it("names the current account and leaves other generated author IDs out", () => {
        project.page = { revisions: [
            { id: "v1", message: "First", by: project.session.account.id },
            { id: "v2", message: "Second", by: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
            { id: "v3", message: "Third", by: "Lin" },
        ], more: false };
        const view = render(<TeamHistoryRail surface={surface()} collapsed={false} onCollapsedChange={() => undefined} />);
        expect(view.container.textContent).toContain("Ada");
        expect(view.container.textContent).toContain(`saved by ${project.session.account.displayName}`);
        expect(view.container.textContent).not.toContain("{Ada}");
        expect(view.container.textContent).toContain("Lin");
        expect(view.container.textContent).not.toContain(project.session.account.id);
        expect(view.container.textContent).not.toContain("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    });

    it("names conflicts and preserves the selected original conflict", async () => {
        const conflicts = [
            { kind: "story", storyId, op: { op: "update-block", sceneId, blockId, payload: { action: "narration", text: { value: "New line" } } }, mine: { name: "Old story name", scenes: { [sceneId]: scene } }, reason: "conflict" },
            { kind: "file", path: assetPath, mine: new Uint8Array([1]), reason: "conflict" },
            { kind: "story", storyId: missingStoryA, op: { op: "delete-story" }, mine: null, reason: "conflict" },
            { kind: "story", storyId: missingStoryB, op: { op: "delete-story" }, mine: null, reason: "conflict" },
        ] as unknown as TeamDocView["conflicts"];
        const view = render(<TeamHistoryRail surface={surface(conflicts)} collapsed={false} onCollapsedChange={() => undefined} />);
        await screen.findAllByText(/The Harbour/);
        const list = view.container.querySelector("[data-team-docs-conflicts]")!;
        await waitFor(() => expect(list.textContent).toContain("Harbour artwork"));
        expect(list.textContent).toContain("Arrival");
        expect(list.textContent).toContain("Row changed");
        expect(list.textContent).toContain("New line");
        expect(list.textContent).toContain("Story 1");
        expect(list.textContent).toContain("Story 2");
        expect(list.textContent).not.toContain("update-block");
        expect(list.textContent).not.toContain("delete-story");
        expect(list.textContent).not.toContain(assetPath);
        expect(list.textContent).not.toContain(blockId.slice(0, 8));
        fireEvent.click(within(list as HTMLElement).getAllByRole("button", { name: "Use mine" })[1]!);
        await waitFor(() => expect(project.override).toHaveBeenCalledWith(1));
        const firstButton = within(list as HTMLElement).getAllByRole("button", { name: "Use mine" })[0]!;
        expect(document.getElementById(firstButton.getAttribute("aria-describedby")!)?.textContent).toContain("New line");
    });

    it("names comparison rows from the current project and numbers unreadable stories", async () => {
        project.page = { revisions: [{ id: revisionId, message: "Earlier" }], more: false };
        project.compare.mockResolvedValue([
            { path: storyPath(storyId), kind: "changed" },
            { path: assetPath, kind: "removed" },
            { path: storyPath(missingStoryA), kind: "removed" },
            { path: storyPath(missingStoryB), kind: "removed" },
        ]);
        render(<TeamHistoryRail surface={surface()} collapsed={false} onCollapsedChange={() => undefined} />);
        fireEvent.click(screen.getByRole("button", { name: "Compare with now" }));
        const dialog = await screen.findByRole("dialog");
        await within(dialog).findByText("The Harbour");
        await within(dialog).findByText("Harbour artwork");
        expect(within(dialog).getByText("Story 1")).toBeTruthy();
        expect(within(dialog).getByText("Story 2")).toBeTruthy();
        expect(dialog.textContent).not.toContain("storydoc.json");
        expect(dialog.textContent).not.toContain(assetPath);
        expect(dialog.querySelector(`[data-team-compare="${storyPath(storyId)}"]`)).toBeTruthy();
        expect(project.compare).toHaveBeenCalledWith(revisionId);
        expect(project.readRevisionDocuments).not.toHaveBeenCalled();
    });

    it("names an automatic version in the restore confirmation without a revision ID", async () => {
        project.page = { revisions: [{ id: revisionId }, { id: "another-version" }], more: false };
        render(<TeamHistoryRail surface={surface()} collapsed={false} onCollapsedChange={() => undefined} />);
        expect(screen.getByText("Automatic 1")).toBeTruthy();
        expect(screen.getByText("Automatic 2")).toBeTruthy();
        fireEvent.click(screen.getAllByRole("button", { name: "View" })[1]!);
        await waitFor(() => expect(project.preview).toHaveBeenCalledWith("another-version", "Automatic 2"));
        fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[0]!);
        await waitFor(() => expect(project.confirm).toHaveBeenCalledTimes(1));
        expect(project.confirm.mock.calls[0]![1]).toBe("Automatic 1");
        expect(String(project.confirm.mock.calls[0]![1])).not.toContain(revisionId.slice(0, 12));
        expect(project.restore).toHaveBeenCalledWith(revisionId);
    });

    it.each([
        ["zh", "删除场景"],
        ["ja", "シーンを削除"],
    ] as const)("renders a scene conflict in %s", async (locale, action) => {
        i18nStore.setLocale(locale);
        const conflicts = [{ kind: "story", storyId, op: { op: "delete-scene", sceneId }, mine: { name: "The Harbour", scenes: { [sceneId]: scene } }, reason: "conflict" }] as unknown as TeamDocView["conflicts"];
        const view = render(<TeamHistoryRail surface={surface(conflicts)} collapsed={false} onCollapsedChange={() => undefined} />);
        await waitFor(() => expect(view.container.textContent).toContain(action));
        expect(view.container.textContent).toContain("Arrival");
        expect(view.container.textContent).not.toContain(sceneId);
    });

    it("numbers otherwise identical conflicts and preserves text from the offline edit", async () => {
        const op = { op: "update-block", sceneId, blockId, payload: { action: "narration", text: { value: `Draft ${sceneId}` } } };
        const conflicts = [
            { kind: "story", storyId, op, mine: { scenes: { [sceneId]: scene } }, reason: "conflict" },
            { kind: "story", storyId, op, mine: { scenes: { [sceneId]: scene } }, reason: "conflict" },
        ] as unknown as TeamDocView["conflicts"];
        const view = render(<TeamHistoryRail surface={surface(conflicts)} collapsed={false} onCollapsedChange={() => undefined} />);
        await screen.findAllByText(/The Harbour/);
        const rows = view.container.querySelectorAll("[data-team-docs-conflicts] li");
        expect(rows[0]!.textContent).toContain("Draft … 1");
        expect(rows[1]!.textContent).toContain("Draft … 2");
        expect(rows[0]!.textContent).not.toContain(sceneId);
    });

    it("uses an offline story's own name and numbers unreadable file names", async () => {
        const conflicts = [
            { kind: "story", storyId: missingStoryA, op: { op: "delete-story" }, mine: { name: "Old story", scenes: {} }, reason: "conflict" },
            { kind: "file", path: `custom/${missingStoryA}.dat`, mine: null, reason: "conflict" },
            { kind: "file", path: `custom/${missingStoryB}.dat`, mine: new Uint8Array([1]), reason: "conflict" },
        ] as unknown as TeamDocView["conflicts"];
        const view = render(<TeamHistoryRail surface={surface(conflicts)} collapsed={false} onCollapsedChange={() => undefined} />);
        const list = view.container.querySelector("[data-team-docs-conflicts]")!;
        await waitFor(() => expect(list.textContent).toContain("Old story"));
        expect(list.textContent).toContain("Project item 1");
        expect(list.textContent).toContain("Project item 2");
        expect(list.textContent).not.toContain(missingStoryA);
        expect(list.textContent).not.toContain(missingStoryB);
    });
});
