import { afterEach, describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { setDesignTimeLocalizationKeys } from "@/lib/ui-editor/runtime/localization/designTimeKeys";
import { boundTextSourceOf, isInlineTextEditableElement, resolveInlineTextEditHost } from "./inlineTextEdit";

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

describe("boundTextSourceOf", () => {
    const text = (props: Record<string, unknown>, valueBindings?: UIElement["valueBindings"]) =>
        ({ id: "t", type: "nl.text", props, ...(valueBindings ? { valueBindings } : {}) }) as UIElement;
    const FIELD = { text: { kind: "listItemField", fieldId: "title" } } as UIElement["valueBindings"];
    const BLUEPRINT = { text: { kind: "blueprintValue", blueprintId: "bp-1", valueType: "string" } } as UIElement["valueBindings"];

    afterEach(() => setDesignTimeLocalizationKeys(null));

    it("names the row field or the value blueprint that decides the words", () => {
        expect(boundTextSourceOf(text({ text: "x" }, FIELD))).toEqual({ kind: "listItemField", fieldId: "title" });
        expect(boundTextSourceOf(text({ text: "x" }, BLUEPRINT))).toEqual({ kind: "blueprintValue", blueprintId: "bp-1" });
        expect(
            boundTextSourceOf({ id: "b", type: "nl.button", props: { label: "x" }, valueBindings: { label: { kind: "listItemField", fieldId: "f" } } } as unknown as UIElement),
        ).toEqual({ kind: "listItemField", fieldId: "f" });
    });

    it("is nothing for an element whose own words are typed", () => {
        expect(boundTextSourceOf(text({ text: "x" }))).toBeNull();
        expect(boundTextSourceOf(null)).toBeNull();
    });

    it("lets a key the canvas draws win over a binding, as it does in the game", () => {
        setDesignTimeLocalizationKeys({ "menu.start": "Start" });
        expect(boundTextSourceOf(text({ text: "x", localizationKey: "menu.start" }, BLUEPRINT))).toBeNull();
    });

    it("reports the binding when no key is drawn (the project ships no keys)", () => {
        expect(boundTextSourceOf(text({ text: "x", localizationKey: "menu.start" }, BLUEPRINT))).toEqual({
            kind: "blueprintValue",
            blueprintId: "bp-1",
        });
    });

    it("is nothing on a site the canvas never types on", () => {
        expect(
            boundTextSourceOf({ id: "d", type: "nl.dialog.sentence", props: { text: "x" }, valueBindings: BLUEPRINT } as unknown as UIElement),
        ).toBeNull();
    });
});
