// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoryMotionEditorTab } from "@/apps/workspace/modules/story-motion/StoryMotionEditorTab";
import { HistoryService } from "../history/HistoryService";
import { storyMotionHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { FocusArea } from "../ui/types";
import { StoryService } from "./StoryService";

const environment = vi.hoisted(() => ({
    workspace: null as unknown,
    bindings: [] as { id: string; handler: () => void }[],
}));

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));
vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => environment.workspace }));
vi.mock("@/apps/workspace/hooks", async () => {
    const { useHistoryScope } = await import("@/apps/workspace/hooks/useHistoryScope");
    return {
        useHistoryScope,
        useKeybindings: ({ keybindings }: { keybindings: typeof environment.bindings }) => { environment.bindings = keybindings; },
        whenEditorFocused: () => () => true,
    };
});
vi.mock("@/apps/workspace/hooks/useShortcutLabels", () => ({ useShortcutLabels: () => ({ forBinding: () => "" }) }));
vi.mock("@/apps/workspace/components/ui/freezeGuard", () => ({
    useFreezeGuard: () => ({ frozen: false, reason: "", run: (handler: unknown) => handler }),
}));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...await importOriginal<typeof import("@/lib/i18n")>(),
    useTranslation: () => ({ t: (key: string) => key }),
    translate: (key: string) => key,
}));
vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({ useAssetObjectUrl: () => ({ url: null }) }));
vi.mock("@/lib/tooltip", () => ({ TooltipGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/components/elements/Select", () => ({ Select: () => null }));
vi.mock("@/apps/workspace/components/ui/ResizableHandle", () => ({ ResizableHandle: () => null }));
vi.mock("@/apps/workspace/modules/story-motion/StoryMotionStagePreview", () => ({ StoryMotionStagePreview: () => null }));
vi.mock("@/apps/workspace/modules/story-motion/StoryMotionTimelineView", () => ({
    clampPxPerMs: (value: number) => value,
    formatSeconds: (value: number) => String(value),
    orderStoryMotionTracks: (tracks: unknown[]) => tracks,
    StoryMotionTimeline: ({ tracks, actions }: {
        tracks: { id: string }[];
        actions: { deleteTrack: (id: string) => void };
    }) => (
        <div>
            <span data-testid="track-count">{tracks.length}</span>
            {tracks.map(track => <button key={track.id} onClick={() => actions.deleteTrack(track.id)}>Delete {track.id}</button>)}
        </div>
    ),
}));

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    environment.workspace = null;
    environment.bindings = [];
});

describe("story motion editor with an empty timeline", () => {
    it("deletes the last track and records one undoable edit", async () => {
        vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
        const history = new HistoryService();
        const story = new StoryService();
        const ui = {
            editor: { update: vi.fn() },
            focus: { getFocus: () => ({ area: FocusArea.Editor, targetId: "motion-tab" }), setFocus: vi.fn(), onFocusChange: () => () => undefined },
            getStore: () => ({ getSelection: () => ({ type: null, data: null }), setSelection: vi.fn() }),
            panels: { show: vi.fn() },
        };
        const fs = {
            isDirExists: async () => ({ ok: true as const, data: true }),
            writeFileNoFollowOrCreate: async () => ({ ok: true as const, data: undefined }),
        };
        const context = {
            project: { resolve: (...parts: (string | string[])[]) => parts.flat().join("/") },
            services: {
                get(id: Services) {
                    if (id === Services.History) return history;
                    if (id === Services.Story) return story;
                    if (id === Services.UI) return ui;
                    if (id === Services.FileSystem) return fs;
                    if (id === Services.Project) return { getProjectConfig: () => ({ metadata: { resolution: "1280x720" } }) };
                    if (id === Services.PanelState) return { getPanelState: () => undefined, setPanelState: vi.fn() };
                    if (id === Services.Uuid) return { generate: () => "00000000-0000-4000-8000-000000000001" };
                    throw new Error(`Unexpected service ${id}`);
                },
            },
            commandLineRun: false,
        } as never;
        history.setContext(context);
        story.setContext(context);
        (story as never as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };
        const asset = await story.createAnimationAsset({
            name: "Motion",
            timeline: { tracks: [{ id: "rotation", property: "rotation", keyframes: [{ id: "key", timeMs: 100, value: 30 }] }] },
        });
        environment.workspace = { context, isInitialized: true };
        render(<StoryMotionEditorTab tabId="motion-tab" payload={{ animationId: asset.id }} active />);

        const button = await screen.findByRole("button", { name: "Delete rotation" });
        fireEvent.click(button);
        await waitFor(() => expect(screen.getByTestId("track-count").textContent).toBe("0"));
        const scope = storyMotionHistoryScope(asset.id);
        await waitFor(() => expect(history.canUndo(scope)).toBe(true));
        act(() => { environment.bindings.find(binding => binding.id === "undo")!.handler(); });
        await screen.findByRole("button", { name: "Delete rotation" });
        expect(history.canUndo(scope)).toBe(false);
        expect(history.canRedo(scope)).toBe(true);
        act(() => { environment.bindings.find(binding => binding.id === "redo")!.handler(); });
        await waitFor(() => expect(screen.getByTestId("track-count").textContent).toBe("0"));
        expect(history.canUndo(scope)).toBe(true);
        await story.flushPendingChanges();
    });
});
