import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { isInlineTextEditableElement, resolveInlineTextEditHost } from "./inlineTextEdit";

const stateService = {} as NonNullable<UIHostAdapter["editorStateService"]>;
const documentService = {} as NonNullable<UIHostAdapter["editorDocumentService"]>;

/** The editor tab's adapter: the only one that hands its services down. */
function editorAdapter(extra: Partial<UIHostAdapter> = {}): UIHostAdapter {
    return {
        host: "app",
        editorStateService: stateService,
        editorDocumentService: documentService,
        ...extra,
    };
}

describe("isInlineTextEditableElement", () => {
    it("is the two widgets that attach their own double-click", () => {
        expect(isInlineTextEditableElement({ type: "nl.text" } as UIElement)).toBe(true);
        expect(isInlineTextEditableElement({ type: "nl.button" } as UIElement)).toBe(true);
        expect(isInlineTextEditableElement({ type: "nl.image" } as UIElement)).toBe(false);
        expect(isInlineTextEditableElement(null)).toBe(false);
    });
});

describe("resolveInlineTextEditHost", () => {
    it("hands the services to the editor canvas", () => {
        expect(resolveInlineTextEditHost(editorAdapter())).toEqual({ stateService, documentService });
    });

    it("refuses a preview, which has no services of its own", () => {
        // The surfaces panel previews every surface, including the one open in the editor tab.
        expect(resolveInlineTextEditHost({ host: "app" })).toBeNull();
    });

    it("refuses a runtime surface", () => {
        const runtime = { surfaceId: "s" } as NonNullable<UIHostAdapter["blueprintRuntime"]>;
        expect(resolveInlineTextEditHost(editorAdapter({ blueprintRuntime: runtime }))).toBeNull();
    });

    /**
     * The frozen-workspace leak this seam was widened for.
     *
     * The text and button widgets attach `onDoubleClick` inside their own markup, so the canvas
     * gesture table - which does list `inlineTextEdit` as a write - never saw it: measured on a
     * frozen workspace, double-clicking a text element opened its editor, accepted typing, and threw
     * the result away on thaw. Answering null here switches off the double-click handler (it returns
     * early without a state service) and the textarea (no override can be read), together.
     */
    it("refuses a read-only surface, so no inline edit can start inside a frozen project", () => {
        expect(resolveInlineTextEditHost(editorAdapter({ editorReadOnly: { active: true } }))).toBeNull();
    });

    it("hands them back once the surface is writable again", () => {
        expect(resolveInlineTextEditHost(editorAdapter({ editorReadOnly: { active: false } })))
            .toEqual({ stateService, documentService });
    });
});
