// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROPERTIES_PANEL_ID } from "@/apps/workspace/modules/properties/propertiesPanelId";
import { SEARCH_PANEL_ID } from "@/apps/workspace/modules/search/searchPanelId";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { projectHistoryScope, searchReplaceHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import { Services } from "@/lib/workspace/services/services";
import { FocusManager } from "@/lib/workspace/services/ui/FocusManager";
import { KeybindingService } from "@/lib/workspace/services/ui/KeybindingService";
import { UIStore } from "@/lib/workspace/services/ui/UIStore";
import { FocusArea } from "@/lib/workspace/services/ui/types";

const fixture = vi.hoisted(() => ({
    context: null as unknown,
    frozen: false,
    reopenClosedTab: vi.fn(),
    group: null as null | { actions: Array<{ id: string; label: string; disabled?: boolean; onClick: () => void }> },
    registry: {
        registerActionGroup: (group: typeof fixture.group) => { fixture.group = group; },
        unregisterActionGroup: () => { fixture.group = null; },
    },
    t: (key: string, params?: { step?: string }) => params?.step ? `${key}: ${params.step}` : key,
}));

vi.mock("../../context", () => ({ useWorkspace: () => ({ context: fixture.context }) }));
vi.mock("../../registry", () => ({ useRegistry: () => fixture.registry }));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: fixture.t }) }));
vi.mock("@/lib/app/platform", () => ({ isMacPlatform: () => false }));
vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));
vi.mock("../../session/workspaceClosedTabsStore", () => ({ reopenLastClosedTab: fixture.reopenClosedTab }));
vi.mock("../ui/freezeGuard", () => ({
    useFreezeGuard: () => fixtureFreezeGuard,
}));
vi.mock("@/apps/workspace/hooks", async () => {
    const bindings = await import("@/apps/workspace/hooks/keybinding/useKeybinding");
    const conditions = await import("@/apps/workspace/hooks/keybinding/conditions");
    return {
        useKeybinding: bindings.useKeybinding,
        useKeybindings: bindings.useKeybindings,
        whenEditorFocused: conditions.whenEditorFocused,
    };
});

import { WorkspaceHistoryMenu } from "./WorkspaceHistoryMenu";
import { WorkspaceUndoKeybindings } from "./WorkspaceUndoKeybindings";
import { SearchUndoKeybindings } from "./SearchUndoKeybindings";
import { EditorProjectUndoKeybindings } from "./EditorProjectUndoKeybindings";
import { EditorClosedTabsKeybinding } from "./EditorClosedTabsKeybinding";

const fixtureFreezeGuard = {
    run: <T extends (...args: any[]) => any>(handler: T) =>
        (...args: Parameters<T>) => fixture.frozen ? undefined : handler(...args),
};
const FIRST_SCOPE = "ui-surface:first";
const SECOND_SCOPE = "ui-surface:second";

describe("workspace history while the inspector has focus", () => {
    let history: HistoryService;
    let focus: FocusManager;
    let keybindings: KeybindingService;
    let undoFirst: ReturnType<typeof vi.fn>;
    let undoSecond: ReturnType<typeof vi.fn>;
    let redoSecond: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        history = new HistoryService();
        focus = new FocusManager();
        const store = new UIStore();
        keybindings = new KeybindingService(focus, store);
        const ui = { focus, keybindings, getStore: () => store };
        fixture.context = {
            services: {
                get: (id: string) => id === Services.UI ? ui : id === Services.History ? history : undefined,
            },
        };
        undoFirst = vi.fn();
        undoSecond = vi.fn();
        redoSecond = vi.fn();
        history.pushCommand(FIRST_SCOPE, {
            label: { key: "workspace.history.entry.edit" },
            undo: undoFirst,
            redo: () => {},
        });
        history.pushCommand(SECOND_SCOPE, {
            label: { key: "workspace.history.entry.surfaceEdit" },
            undo: undoSecond,
            redo: redoSecond,
        });
        history.setActiveScope(FIRST_SCOPE);
        focus.setFocus(FocusArea.RightPanel, PROPERTIES_PANEL_ID);
        keybindings.start();
    });

    afterEach(() => {
        cleanup();
        keybindings.stop();
        fixture.context = null;
        fixture.group = null;
        fixture.frozen = false;
        fixture.reopenClosedTab.mockReset();
    });

    it("routes Undo and Redo to the current editor scope after it changes", () => {
        render(<WorkspaceUndoKeybindings />);

        act(() => {
            history.setActiveScope(SECOND_SCOPE);
            fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
        });

        expect(undoFirst).not.toHaveBeenCalled();
        expect(undoSecond).toHaveBeenCalledOnce();
        expect(history.canRedo(SECOND_SCOPE)).toBe(true);
        fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true });
        expect(redoSecond).toHaveBeenCalledOnce();
    });

    it("updates the Edit menu when the current editor scope changes", () => {
        render(<WorkspaceHistoryMenu />);
        expect(fixture.group?.actions[0].label).toContain("workspace.history.entry.edit");

        act(() => history.setActiveScope(SECOND_SCOPE));

        expect(fixture.group?.actions[0].label).toContain("workspace.history.entry.surfaceEdit");
        act(() => fixture.group?.actions[0].onClick());
        expect(undoFirst).not.toHaveBeenCalled();
        expect(undoSecond).toHaveBeenCalledOnce();
    });

    it("routes the Search panel shortcut to its own stack and leaves text fields alone", () => {
        const undoSearch = vi.fn();
        const undoProject = vi.fn();
        history.pushCommand(searchReplaceHistoryScope(), {
            label: { key: "workspace.history.entry.edit" },
            undo: undoSearch,
            redo: () => {},
        });
        history.pushCommand(projectHistoryScope(), {
            label: { key: "workspace.history.entry.edit" },
            undo: undoProject,
            redo: () => {},
        });
        render(<><WorkspaceUndoKeybindings /><SearchUndoKeybindings /></>);
        act(() => focus.setFocus(FocusArea.LeftPanel, SEARCH_PANEL_ID));
        const input = document.createElement("input");
        document.body.append(input);
        fireEvent.keyDown(input, { key: "z", ctrlKey: true });
        expect(undoSearch).not.toHaveBeenCalled();

        fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
        expect(undoSearch).toHaveBeenCalledOnce();
        expect(undoProject).not.toHaveBeenCalled();
        input.remove();
    });

    it("routes a project editor's shortcut to the project stack", () => {
        const undoProject = vi.fn();
        history.pushCommand(projectHistoryScope(), {
            label: { key: "workspace.history.entry.edit" },
            undo: undoProject,
            redo: () => {},
        });
        render(<><WorkspaceUndoKeybindings /><EditorProjectUndoKeybindings tabId="image" /></>);
        act(() => focus.setFocus(FocusArea.Editor, "image"));

        fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
        expect(undoProject).toHaveBeenCalledOnce();
        expect(undoFirst).not.toHaveBeenCalled();
    });

    it("blocks local history while frozen", () => {
        fixture.frozen = true;
        render(<WorkspaceUndoKeybindings />);
        fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
        fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true });
        expect(undoFirst).not.toHaveBeenCalled();
        expect(history.canUndo(FIRST_SCOPE)).toBe(true);
    });

    it("reopens a closed tab from a text field and unregisters the shortcut on unmount", () => {
        const mounted = render(<EditorClosedTabsKeybinding />);
        const input = document.createElement("input");
        document.body.append(input);
        fireEvent.keyDown(input, { key: "t", ctrlKey: true, shiftKey: true });

        expect(fixture.reopenClosedTab).toHaveBeenCalledOnce();
        expect(fixture.reopenClosedTab.mock.calls[0][0]).toBe(fixture.context);
        mounted.unmount();
        fireEvent.keyDown(input, { key: "t", ctrlKey: true, shiftKey: true });
        expect(fixture.reopenClosedTab).toHaveBeenCalledOnce();
        input.remove();
    });
});
