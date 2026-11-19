// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FocusManager } from "@/lib/workspace/services/ui/FocusManager";
import { UIStore } from "@/lib/workspace/services/ui/UIStore";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import type { EditorGroup as EditorGroupType, EditorLayout } from "../../registry/types";
import { buildEditorQuickSwitchOrder } from "./editorQuickSwitchModel";

const fixture = vi.hoisted(() => ({
    context: null as unknown,
    registry: null as unknown,
}));

vi.mock("../../context", () => ({ useWorkspace: () => ({ context: fixture.context, recovery: true }) }));
vi.mock("../../registry", () => ({ useRegistry: () => fixture.registry }));
vi.mock("../../hooks", () => ({
    useKeybinding: () => {},
    contextual: (predicate: unknown) => predicate,
    whenEditorTabsFocused: () => () => true,
    useMaxActiveEditors: () => 3,
}));
vi.mock("../../hooks/useShortcutLabels", () => ({ useShortcutLabels: () => ({ forBinding: () => undefined }) }));
vi.mock("../ui/ShortcutContextMenu", () => ({ ShortcutContextMenu: () => null }));
vi.mock("@/lib/workspace/hooks/useWorkspaceReloadGeneration", () => ({ useWorkspaceReloadGeneration: () => 0 }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../WorkspacePanelErrorBoundary", () => ({
    WorkspacePanelErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./useEditorGroupDrop", async () => {
    const { useRef } = await import("react");
    return {
        useEditorGroupDrop: () => ({ dropTargetProps: {}, stripRef: useRef(null), zone: null, insertion: null }),
    };
});

import { EditorGroup } from "./EditorGroup";

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    fixture.context = null;
    fixture.registry = null;
});

describe("editor group focus", () => {
    it("records a body click as the most recently focused editor", () => {
        vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
        const focus = new FocusManager();
        const store = new UIStore();
        const left: EditorGroupType = {
            id: "left",
            focus: "tab-left",
            tabs: [{ id: "tab-left", title: "Left", component: () => <span>Left editor</span> }],
        };
        const right: EditorGroupType = {
            id: "right",
            focus: "tab-right",
            tabs: [{ id: "tab-right", title: "Right", component: () => <span>Right editor</span> }],
        };
        const layout: EditorLayout = { id: "split", direction: "horizontal", ratio: 0.5, first: left, second: right };
        store.restoreEditorLayout(layout);
        focus.setFocus(FocusArea.Editor, "tab-right");
        const ui = { focus, getStore: () => store };
        fixture.context = { services: { get: () => ui } };
        fixture.registry = {
            editorLayout: layout,
            closeEditorTab: vi.fn(),
            closeEditorTabs: vi.fn(),
            setActiveEditorTab: (tabId: string, groupId: string) => {
                store.setActiveEditorTabInGroup(tabId, groupId);
                focus.setFocus(FocusArea.Editor, tabId);
            },
        };

        render(<EditorGroup group={left} />);
        fireEvent.click(screen.getByText("Left editor"));

        expect(focus.getFocus()).toEqual({ area: FocusArea.Editor, targetId: "tab-left" });
        expect(store.getLastFocusedEditorTab()).toEqual({ groupId: "left", tabId: "tab-left" });
        expect(buildEditorQuickSwitchOrder(layout, store.getEditorTabFocusHistoryKeys()).candidates.map(row => row.tabId))
            .toEqual(["tab-left", "tab-right"]);

        const changed = vi.fn();
        const unsubscribe = store.getEvents().on("editorLayoutChanged", changed);
        fireEvent.click(screen.getByText("Left editor"));
        expect(changed).not.toHaveBeenCalled();
        unsubscribe();
    });
});
