// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyVariableRegistry } from "@shared/variables/variableRegistryModel";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { GAME_UI_REFRESH_DEBOUNCE_MS } from "./useGameUiEditBursts";
import { useStoryPreviewGameUi } from "./useStoryPreviewGameUi";

vi.mock("@/lib/ui-editor/widget-modules/pluginElementRenderers", () => ({
    usePluginElementRenderers: () => undefined,
}));

vi.mock("@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore", async () => {
    const { useMemo } = await import("react");
    return {
        useBlueprintRuntimeCore: (bundle: object | null) => useMemo(
            () => bundle ? { scopeBridge: { globalSet: vi.fn() } } : null,
            [bundle],
        ),
    };
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("the story preview's character data", () => {
    it("rebuilds the stage data after a character is edited while the preview is open", () => {
        vi.useFakeTimers();
        let name = "Alice";
        const listeners = new Set<() => void>();
        const character = {
            profile: { getId: () => "alice", getName: () => name, getColor: () => "" },
            toJSON: () => ({ profile: { id: "alice", name, appearance: { kind: "preset", poses: [] } } }),
        };
        const services: Record<string, unknown> = {
            [Services.Project]: { getProjectConfig: () => ({}) },
            [Services.Character]: {
                listCharacter: () => [character],
                subscribe: (listener: () => void) => {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
            },
            [Services.UIDocument]: { getDocument: () => ({}), getRevision: () => 0, onDocumentChanged: () => () => undefined },
            [Services.UIGraph]: { getDocument: () => ({}), getRevision: () => 0, onGraphsChanged: () => () => undefined },
            [Services.LocalBlueprint]: { getBlueprintDocument: () => ({ blueprints: {} }) },
            [Services.VariableRegistry]: { getRegistry: () => createEmptyVariableRegistry() },
            [Services.SaveSchema]: { listFields: () => [] },
        };
        const context = { services: { get: (id: string) => services[id] } } as unknown as WorkspaceContext;
        const { result, unmount } = renderHook(() => useStoryPreviewGameUi({ context, enabled: true }));
        const firstGameUi = result.current.gameUi;
        expect(result.current.characters[0]?.name).toBe("Alice");

        act(() => {
            name = "Alicia";
            listeners.forEach(listener => listener());
            vi.advanceTimersByTime(GAME_UI_REFRESH_DEBOUNCE_MS);
        });
        expect(result.current.characters[0]?.name).toBe("Alicia");
        expect(result.current.gameUi).not.toBe(firstGameUi);
        unmount();
        expect(listeners.size).toBe(0);
    });
});
