// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { GAME_UI_REFRESH_DEBOUNCE_MS, useGameUiEditBursts } from "./useGameUiEditBursts";
import {
    GAME_UI_REFRESH_DELAY_MS,
    RECOMPILE_DEBOUNCE_MS,
    ROW_SWITCH_DEBOUNCE_MS,
    SKIP_TYPING_TOGGLE_DELAY_MS,
    storyPreviewRebuildDelay,
    type StoryPreviewRebuildInput,
} from "./storyPreviewRebuildSchedule";

/**
 * The live preview picks up edits to the Game UI while it is open: a burst of edits to the interface
 * document or to its blueprints becomes one refresh once the burst settles, and that refresh rebuilds
 * the stage at once rather than waiting a second time.
 */

vi.mock("@/lib/workspace/services/services", () => ({
    Services: { UIDocument: "uiDocument", UIGraph: "uiGraph" },
}));

type Listener = () => void;

function fakeContext() {
    const documentListeners = new Set<Listener>();
    const graphListeners = new Set<Listener>();
    const revision = { document: 0, graphs: 0 };
    const services = {
        uiDocument: {
            getRevision: () => revision.document,
            onDocumentChanged: (listener: Listener) => {
                documentListeners.add(listener);
                return () => documentListeners.delete(listener);
            },
        },
        uiGraph: {
            getRevision: () => revision.graphs,
            onGraphsChanged: (listener: Listener) => {
                graphListeners.add(listener);
                return () => graphListeners.delete(listener);
            },
        },
    };
    const context = { services: { get: (id: keyof typeof services) => services[id] } } as unknown as WorkspaceContext;
    return {
        context,
        editDocument: () => {
            revision.document += 1;
            documentListeners.forEach(listener => listener());
        },
        editGraphs: () => {
            revision.graphs += 1;
            graphListeners.forEach(listener => listener());
        },
        /** What the graph document does after an autosave: it announces itself, at the same revision. */
        saveGraphs: () => graphListeners.forEach(listener => listener()),
        listenerCount: () => documentListeners.size + graphListeners.size,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("Game UI edits refresh the live preview", () => {
    it("turns a burst of interface edits into one refresh once the burst settles", () => {
        const fake = fakeContext();
        const { result } = renderHook(() => useGameUiEditBursts(fake.context, true));
        expect(result.current).toBe(0);

        // Ten nudges, an arrow key every 100ms: nothing until the author stops.
        for (let i = 0; i < 10; i++) {
            act(() => {
                fake.editDocument();
                vi.advanceTimersByTime(100);
            });
        }
        expect(result.current).toBe(0);

        act(() => {
            vi.advanceTimersByTime(GAME_UI_REFRESH_DEBOUNCE_MS);
        });
        expect(result.current).toBe(1);
    });

    it("hears blueprint edits as well as interface edits", () => {
        const fake = fakeContext();
        const { result } = renderHook(() => useGameUiEditBursts(fake.context, true));
        act(() => {
            fake.editGraphs();
            vi.advanceTimersByTime(GAME_UI_REFRESH_DEBOUNCE_MS);
        });
        expect(result.current).toBe(1);
    });

    it("does not refresh for a save, which changes nothing on the stage", () => {
        const fake = fakeContext();
        const { result } = renderHook(() => useGameUiEditBursts(fake.context, true));
        act(() => {
            fake.editDocument();
            vi.advanceTimersByTime(GAME_UI_REFRESH_DEBOUNCE_MS);
        });
        expect(result.current).toBe(1);
        act(() => {
            fake.saveGraphs();
            vi.advanceTimersByTime(GAME_UI_REFRESH_DEBOUNCE_MS);
        });
        expect(result.current).toBe(1);
    });

    it("listens only while the preview is open", () => {
        const fake = fakeContext();
        const { result, rerender } = renderHook(({ enabled }) => useGameUiEditBursts(fake.context, enabled), {
            initialProps: { enabled: false },
        });
        expect(fake.listenerCount()).toBe(0);
        act(() => {
            fake.editDocument();
            vi.advanceTimersByTime(GAME_UI_REFRESH_DEBOUNCE_MS);
        });
        expect(result.current).toBe(0);

        rerender({ enabled: true });
        expect(fake.listenerCount()).toBe(2);
        act(() => {
            fake.editDocument();
        });
        // Closing mid-burst drops the pending refresh with the listeners.
        rerender({ enabled: false });
        act(() => {
            vi.advanceTimersByTime(GAME_UI_REFRESH_DEBOUNCE_MS);
        });
        expect(result.current).toBe(0);
        expect(fake.listenerCount()).toBe(0);
    });
});

describe("preview rebuild schedule", () => {
    const document = {};
    const gameUi = {};
    const base: StoryPreviewRebuildInput = { document, sceneId: "clubroom", targetId: "row-5", gameUi, skipTyping: false };

    it("rebuilds at once for a newer Game UI alone", () => {
        expect(storyPreviewRebuildDelay(base, { ...base, gameUi: {} })).toBe(GAME_UI_REFRESH_DELAY_MS);
    });

    it("rebuilds at once when skipping the typing is turned on or off", () => {
        expect(storyPreviewRebuildDelay(base, { ...base, skipTyping: true })).toBe(SKIP_TYPING_TOGGLE_DELAY_MS);
        expect(storyPreviewRebuildDelay(base, { ...base, skipTyping: true, targetId: "row-6" })).toBe(ROW_SWITCH_DEBOUNCE_MS);
    });

    it("keeps the row-switch and edit pauses for everything else", () => {
        expect(storyPreviewRebuildDelay(base, { ...base, targetId: "row-6" })).toBe(ROW_SWITCH_DEBOUNCE_MS);
        expect(storyPreviewRebuildDelay(base, { ...base, targetId: "row-6", gameUi: {} })).toBe(ROW_SWITCH_DEBOUNCE_MS);
        expect(storyPreviewRebuildDelay(base, { ...base, document: {} })).toBe(RECOMPILE_DEBOUNCE_MS);
        expect(storyPreviewRebuildDelay(base, { ...base, sceneId: "corridor" })).toBe(RECOMPILE_DEBOUNCE_MS);
        expect(storyPreviewRebuildDelay(null, base)).toBe(RECOMPILE_DEBOUNCE_MS);
    });
});
