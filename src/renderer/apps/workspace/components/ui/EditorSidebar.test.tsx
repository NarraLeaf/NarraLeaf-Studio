// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => {
    const stored = new Map<string, unknown>();
    return {
        stored,
        getSync: (key: string) => stored.get(key),
        set: vi.fn(async (key: string, value: unknown) => {
            stored.set(key, value);
        }),
    };
});

vi.mock("@/apps/workspace/context/WorkspaceContext", () => ({
    useOptionalWorkspace: () => ({ context: { services: { get: () => settings } }, isInitialized: true }),
}));

import {
    EDITOR_SIDEBARS,
    EDITOR_SIDEBAR_EDITOR_RESERVE,
    EditorSidebarResizeHandle,
    editorSidebarCssWidth,
    editorSidebarSettingsKey,
    normalizeEditorSidebarWidth,
    resolveEditorSidebarWidth,
    useEditorSidebarWidth,
    type EditorSidebarId,
} from "./EditorSidebar";

afterEach(() => {
    cleanup();
    settings.set.mockClear();
});

function Probe({ id }: { id: EditorSidebarId }) {
    return <output data-testid="width">{useEditorSidebarWidth(id)}</output>;
}

/** An editor `editorWidth` wide holding one sidebar with its seam. */
function renderSidebar(id: EditorSidebarId, edge: "left" | "right", editorWidth: number) {
    const view = render(
        <div data-testid="editor">
            <aside className="relative">
                <EditorSidebarResizeHandle id={id} edge={edge} />
            </aside>
            <Probe id={id} />
        </div>,
    );
    Object.defineProperty(view.getByTestId("editor"), "clientWidth", { value: editorWidth });
    return {
        width: () => Number(view.getByTestId("width").textContent),
        drag: (from: number, to: number, release = true) => {
            fireEvent.mouseDown(view.container.querySelector('[role="separator"]')!, { clientX: from });
            act(() => {
                document.dispatchEvent(new MouseEvent("mousemove", { clientX: to }));
            });
            if (release) {
                act(() => {
                    document.dispatchEvent(new MouseEvent("mouseup", { clientX: to }));
                });
            }
        },
    };
}

describe("editor sidebar widths", () => {
    it("reads a stored width back inside the sidebar's bounds, and anything else as the default", () => {
        const spec = EDITOR_SIDEBARS.uiOutline;
        expect(normalizeEditorSidebarWidth("uiOutline", undefined)).toBe(spec.defaultWidth);
        expect(normalizeEditorSidebarWidth("uiOutline", "wide")).toBe(spec.defaultWidth);
        expect(normalizeEditorSidebarWidth("uiOutline", 10)).toBe(spec.minWidth);
        expect(normalizeEditorSidebarWidth("uiOutline", 10_000)).toBe(spec.maxWidth);
        expect(normalizeEditorSidebarWidth("uiOutline", 300.4)).toBe(300);
    });

    it("leaves the editor its reserve, but never draws a sidebar below its minimum", () => {
        const { minWidth } = EDITOR_SIDEBARS.uiOutline;
        expect(resolveEditorSidebarWidth("uiOutline", 400, 1200)).toBe(400);
        expect(resolveEditorSidebarWidth("uiOutline", 400, 500)).toBe(500 - EDITOR_SIDEBAR_EDITOR_RESERVE);
        expect(resolveEditorSidebarWidth("uiOutline", 400, 300)).toBe(minWidth);
        // The CSS states the same rule, so what is drawn and what the editor computes agree.
        expect(editorSidebarCssWidth("uiOutline", 400)).toBe(
            `clamp(${minWidth}px, 400px, calc(100% - ${EDITOR_SIDEBAR_EDITOR_RESERVE}px))`,
        );
    });

    it("writes nothing for a sidebar nobody has dragged", () => {
        const sidebar = renderSidebar("uiOutline", "right", 1200);
        expect(sidebar.width()).toBe(EDITOR_SIDEBARS.uiOutline.defaultWidth);
        expect(settings.set).not.toHaveBeenCalled();
    });

    it("widens a sidebar on the left as its seam is dragged right, and remembers it on release", () => {
        const sidebar = renderSidebar("motionLibrary", "right", 1200);
        const start = sidebar.width();

        sidebar.drag(300, 360, false);
        expect(sidebar.width()).toBe(start + 60);
        expect(settings.set).not.toHaveBeenCalled();

        act(() => {
            document.dispatchEvent(new MouseEvent("mouseup", { clientX: 360 }));
        });
        expect(settings.set).toHaveBeenCalledWith(editorSidebarSettingsKey("motionLibrary"), start + 60);
    });

    it("narrows a sidebar on the right as its seam is dragged right, down to its minimum", () => {
        const sidebar = renderSidebar("sceneFlowRoutes", "left", 1200);
        const start = sidebar.width();

        sidebar.drag(500, 540);
        expect(sidebar.width()).toBe(start - 40);

        sidebar.drag(500, 1500);
        expect(sidebar.width()).toBe(EDITOR_SIDEBARS.sceneFlowRoutes.minWidth);
    });

    it("stops a drag where the editor's reserve begins", () => {
        const sidebar = renderSidebar("blueprintLayers", "right", 600);

        sidebar.drag(100, 2000);

        expect(sidebar.width()).toBe(600 - EDITOR_SIDEBAR_EDITOR_RESERVE);
    });
});
