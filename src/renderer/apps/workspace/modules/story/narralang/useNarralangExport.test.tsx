// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryDocument } from "@shared/types/story";
import { Services } from "@/lib/workspace/services/services";
import { deleteBlockFromScene } from "@/lib/workspace/services/story/storyModel";
import { useNarralangExport } from "./useNarralangExport";

const scene = {
    id: "scene-1",
    name: "Rooftop",
    runtimeName: "Rooftop",
    rootBlockIds: ["line-1"],
    blocks: {
        "line-1": {
            id: "line-1",
            kind: "nodeAction",
            payload: { action: "narration", text: { textId: "text-1", value: "The rain stops.", role: "narration" } },
            parentId: null,
            childrenIds: [],
        },
    },
};
const document = { id: "story-1", name: "Story", scenes: { [scene.id]: scene } } as unknown as StoryDocument;
const loadStory = vi.fn<() => Promise<StoryDocument>>();
const selectSaveFile = vi.fn();
const write = vi.fn();
const showError = vi.fn();
const showNotification = vi.fn();

const services = {
    get(id: Services) {
        switch (id) {
            case Services.Story: return { loadStory, listAnimationAssets: () => [] };
            case Services.Character: return { listCharacter: () => [] };
            case Services.LocalBlueprint: return { listSavedVariables: () => [], listPersistentVariables: () => [] };
            case Services.AppTags: return { listTags: () => [] };
            case Services.UIDocument: return { getDocument: () => ({ surfaces: [] }) };
            case Services.FileSystem: return { write };
            case Services.UI: return { showError, showNotification };
            default: throw new Error(`Unexpected service: ${id}`);
        }
    },
};

vi.mock("../../../context", () => ({ useWorkspace: () => ({ context: { services }, isInitialized: true }) }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...await importOriginal<typeof import("@/lib/i18n")>(),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key }),
}));
vi.mock("@/lib/app/privilegedFacade", () => ({
    appPrivilegedFacade: { fs: { selectSaveFile: (...args: unknown[]) => selectSaveFile(...args) } },
}));

const target = { storyId: "story-1", sceneId: "scene-1" };

beforeEach(() => {
    vi.clearAllMocks();
    loadStory.mockResolvedValue(document);
    selectSaveFile.mockResolvedValue({ success: true, data: { ok: true, data: "/tmp/rooftop.nl" } });
    write.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("NarraLang export", () => {
    it("starts only one export when invoked twice before the story loads", async () => {
        let finishLoading!: (story: StoryDocument) => void;
        const loading = new Promise<StoryDocument>(resolve => { finishLoading = resolve; });
        loadStory.mockReturnValue(loading);
        const { result } = renderHook(() => useNarralangExport());

        act(() => {
            result.current.beginExport(target);
            result.current.beginExport(target);
        });
        await act(async () => { finishLoading(document); await loading; });

        expect(loadStory).toHaveBeenCalledTimes(1);
        expect(selectSaveFile).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledTimes(1);
        expect(write.mock.calls[0][1]).toContain("The rain stops.");
        expect(showNotification).toHaveBeenCalledTimes(1);
    });

    it("starts only one export across the palette and story panel", async () => {
        let finishDialog!: (value: unknown) => void;
        const dialog = new Promise(resolve => { finishDialog = resolve; });
        selectSaveFile.mockReturnValue(dialog);
        const palette = renderHook(() => useNarralangExport());
        const panel = renderHook(() => useNarralangExport());

        act(() => { palette.result.current.beginExport(target); });
        await waitFor(() => expect(selectSaveFile).toHaveBeenCalledTimes(1));
        act(() => { panel.result.current.beginExport(target); });
        await act(async () => {
            finishDialog({ success: true, data: { ok: true, data: "/tmp/rooftop.nl" } });
            await dialog;
        });

        expect(loadStory).toHaveBeenCalledTimes(1);
        expect(selectSaveFile).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledTimes(1);
    });

    it("allows another export after the save dialog is cancelled", async () => {
        selectSaveFile.mockResolvedValueOnce({ success: true, data: { ok: true, data: null } });
        const { result } = renderHook(() => useNarralangExport());

        await act(async () => { result.current.beginExport(target); });
        expect(write).not.toHaveBeenCalled();
        await act(async () => { result.current.beginExport(target); });

        await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
        expect(selectSaveFile).toHaveBeenCalledTimes(2);
    });

    it("allows another export after a write failure", async () => {
        write.mockResolvedValueOnce({ ok: false, error: { code: "NO_SPACE" } });
        const first = renderHook(() => useNarralangExport());
        const second = renderHook(() => useNarralangExport());

        await act(async () => { first.result.current.beginExport(target); });
        expect(showError).toHaveBeenCalledTimes(1);
        expect(showNotification).not.toHaveBeenCalled();
        await act(async () => { second.result.current.beginExport(target); });

        expect(write).toHaveBeenCalledTimes(2);
        expect(showNotification).toHaveBeenCalledTimes(1);
    });

    it("reports a missing scene without opening the save dialog", async () => {
        const { result } = renderHook(() => useNarralangExport());

        await act(async () => { result.current.beginExport({ ...target, sceneId: "missing" }); });

        expect(showError).toHaveBeenCalledWith(expect.objectContaining({ message: "story.narralang.sceneMissing" }));
        expect(selectSaveFile).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
    });

    it.each([
        { scope: "scene", sceneId: "scene-1" },
        { scope: "story", sceneId: null },
    ])("reports omitted rows from a $scope even if the scene changes during the save dialog", async ({ sceneId }) => {
        const editedDocument = structuredClone(document);
        const editedScene = editedDocument.scenes["scene-1"];
        if (sceneId === null) {
            editedDocument.scenes["scene-2"] = {
                id: "scene-2", name: "Corridor", runtimeName: "Corridor", rootBlockIds: [], blocks: {},
            };
        }
        editedScene.rootBlockIds.push("blueprint-row");
        editedScene.blocks["blueprint-row"] = {
            id: "blueprint-row",
            kind: "action",
            payload: { action: "blueprint", blueprintId: "bp-1" },
            parentId: null,
            childrenIds: [],
        } as never;
        loadStory.mockResolvedValue(editedDocument);
        let finishDialog!: (value: unknown) => void;
        const dialog = new Promise(resolve => { finishDialog = resolve; });
        selectSaveFile.mockReturnValue(dialog);
        const { result } = renderHook(() => useNarralangExport());

        act(() => { result.current.beginExport({ ...target, sceneId }); });
        await waitFor(() => expect(selectSaveFile).toHaveBeenCalledTimes(1));
        expect(selectSaveFile).toHaveBeenCalledWith(sceneId ? "Rooftop.nl" : "Story.nl", ["nl"]);
        deleteBlockFromScene(editedScene, "blueprint-row");
        await act(async () => {
            finishDialog({ success: true, data: { ok: true, data: "/tmp/rooftop.nl" } });
            await dialog;
        });

        expect(write).toHaveBeenCalledTimes(1);
        expect(write.mock.calls[0][1]).toContain("The rain stops.");
        render(result.current.dialogs);
        expect(screen.getByText("story.narralang.reason.blueprintAction")).toBeTruthy();
        if (sceneId === null) {
            expect(screen.getByText("Rooftop")).toBeTruthy();
        }
    });
});
