// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeybindingDefinition } from "@/apps/workspace/hooks";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import type { LiveSessionPhase } from "@/lib/workspace/services/live/liveSessionView";

const fixture = vi.hoisted(() => ({
    context: null as unknown,
    bindings: [] as Array<{ id: string; handler: (focus: any) => void }>,
}));

vi.mock("../../context", () => ({ useWorkspace: () => ({ context: fixture.context, isInitialized: true }) }));
vi.mock("@/apps/workspace/hooks", () => ({
    useKeybinding: () => {},
    useKeybindings: (options: { keybindings: typeof fixture.bindings }) => {
        if (options.keybindings.some(binding => binding.id === "undo-ctrl")) fixture.bindings = options.keybindings;
    },
    whenEditorFocused: () => () => true,
    and: () => () => true,
    fromGetter: () => () => true,
}));

import { useUIEditorKeybindings } from "@/lib/ui-editor/interaction/useUIEditorKeybindings";
import { useLiveUndoOverride } from "./uiLiveSession";

afterEach(() => {
    cleanup();
    fixture.context = null;
    fixture.bindings = [];
});

describe("interface and blueprint live undo", () => {
    it("routes surface keys at the current phase, including before a rerender", () => {
        let phase: LiveSessionPhase = "asking";
        const live = { getView: () => ({ phase }), undo: vi.fn(), redo: vi.fn() };
        const history = { undo: vi.fn(), redo: vi.fn() };
        fixture.context = { services: { get: () => live } };

        renderHook(() => {
            const undoOverride = useLiveUndoOverride();
            useUIEditorKeybindings({
                tabId: "surface", surfaceId: "surface", enabled: true, contextMenuOpen: false,
                onCloseContextMenu: () => {}, documentService: {} as never, localBlueprint: {} as never,
                historyService: history as never, stateService: {} as never, uiService: null,
                requestRenamePrimary: () => {}, undoOverride,
            });
        });

        const press = (id: string) => {
            const binding = fixture.bindings.find(item => item.id === id) as KeybindingDefinition;
            expect(binding).toBeDefined();
            binding.handler({ area: FocusArea.Editor, targetId: "surface" });
        };
        press("undo-ctrl");
        press("redo-meta");
        expect(history.undo).toHaveBeenCalledOnce();
        expect(history.redo).toHaveBeenCalledOnce();
        expect(live.undo).not.toHaveBeenCalled();

        phase = "entering";
        press("undo-ctrl");
        press("redo-meta");
        expect(history.undo).toHaveBeenCalledOnce();
        expect(history.redo).toHaveBeenCalledOnce();
        expect(live.undo).toHaveBeenCalledOnce();
        expect(live.redo).toHaveBeenCalledOnce();

        phase = "idle";
        press("undo-ctrl");
        expect(history.undo).toHaveBeenCalledTimes(2);
    });

    it("reports whether the shared override handled a blueprint step", () => {
        let phase: LiveSessionPhase = "asking";
        const live = { getView: () => ({ phase }), undo: vi.fn(), redo: vi.fn() };
        fixture.context = { services: { get: () => live } };
        const { result } = renderHook(() => useLiveUndoOverride());

        expect(result.current?.undo()).toBe(false);
        expect(result.current?.redo()).toBe(false);
        for (const next of ["entering", "catching-up", "active", "leaving"] as const) {
            phase = next;
            expect(result.current?.undo()).toBe(true);
            expect(result.current?.redo()).toBe(true);
        }
        expect(live.undo).toHaveBeenCalledTimes(4);
        expect(live.redo).toHaveBeenCalledTimes(4);
        phase = "idle";
        expect(result.current?.undo()).toBe(false);
    });
});
