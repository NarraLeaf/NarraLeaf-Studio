// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { BUTTON_MARKED_LABEL } from "@/lib/ui-editor/widget-modules/builtin/button/helpers";
import { TEXT_MARKED_LABEL } from "@/lib/ui-editor/widget-modules/builtin/text/helpers";
import type { MarkedLabelProps } from "./markedLabel";
import { TextRunMarksEditor } from "./TextRunMarks";

/** Stand-in for `UIDocumentService`: merges a props patch in place like `updateElementProps` does. */
function createDocumentService(element: UIElement) {
    const document = { elements: { [element.id]: element } };
    let revision = 0;
    const listeners = new Set<() => void>();
    return {
        getDocument: () => document,
        getRevision: () => revision,
        onDocumentChanged(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        updateElementProps: vi.fn((elementId: string, propsPatch: Record<string, unknown>) => {
            const target = document.elements[elementId];
            target.props = { ...(target.props ?? {}), ...propsPatch };
            revision += 1;
            for (const listener of [...listeners]) {
                listener();
            }
        }),
    };
}

function element(type: string, props: Record<string, unknown>): UIElement {
    return {
        id: "el",
        type,
        parentId: "root",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 160, height: 48 },
        props,
    };
}

function mount(target: UIElement, label: MarkedLabelProps) {
    const documentService = createDocumentService(target);
    const view = render(
        <TextRunMarksEditor documentService={documentService as never} element={target} label={label} />,
    );
    const area = view.container.querySelector("textarea")!;
    return { ...view, area, documentService };
}

/** Select `[start, end)` in the box the way a pointer would, which the editor learns about from the document. */
function select(area: HTMLTextAreaElement, start: number, end: number) {
    act(() => {
        area.focus();
        area.setSelectionRange(start, end);
        document.dispatchEvent(new Event("selectionchange"));
    });
}

/** The toolbar's bold button: the first control after the box. */
function boldButton(container: HTMLElement): HTMLButtonElement {
    return container.querySelectorAll("button")[0] as HTMLButtonElement;
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
        callback(0);
        return 0;
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("TextRunMarksEditor", () => {
    it("writes a button's marks beside its label", () => {
        const target = element("nl.button", { label: "Start game" });
        const { area, container, documentService } = mount(target, BUTTON_MARKED_LABEL);
        expect(area.value).toBe("Start game");

        select(area, 0, 5);
        fireEvent.click(boldButton(container));

        expect(documentService.updateElementProps).toHaveBeenLastCalledWith("el", {
            label: "Start game",
            rich: [{ text: "Start", marks: { bold: true } }, { text: " game" }],
        });
        expect(target.props).not.toHaveProperty("text");
    });

    it("writes a text label's marks beside its text", () => {
        const target = element("nl.text", { text: "Start game" });
        const { area, container, documentService } = mount(target, TEXT_MARKED_LABEL);

        select(area, 6, 10);
        fireEvent.click(boldButton(container));

        expect(documentService.updateElementProps).toHaveBeenLastCalledWith("el", {
            text: "Start game",
            rich: [{ text: "Start " }, { text: "game", marks: { bold: true } }],
        });
        expect(target.props).not.toHaveProperty("label");
    });

    it("keeps a button's reading when the box edits another word", () => {
        const target = element("nl.button", {
            label: "山田さん",
            rich: [{ text: "山田", marks: { ruby: "やまだ" } }, { text: "さん" }],
        });
        const { area, documentService } = mount(target, BUTTON_MARKED_LABEL);

        fireEvent.change(area, { target: { value: "山田くん" } });
        fireEvent.blur(area);

        expect(documentService.updateElementProps).toHaveBeenLastCalledWith("el", {
            label: "山田くん",
            rich: [{ text: "山田", marks: { ruby: "やまだ" } }, { text: "くん" }],
        });
    });
});
