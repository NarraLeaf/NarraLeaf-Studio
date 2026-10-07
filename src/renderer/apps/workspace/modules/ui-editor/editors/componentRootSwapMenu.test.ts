/**
 * Which element a component editor's menus offer Set as Root Element and Wrap in Container on.
 *
 * The documents are built by the real adapter, so what is tested is what the editor reads: the frame
 * (the definition's root) offers Wrap in Container, an element directly inside it offers Set as Root
 * Element - greyed with the reason when it cannot be the root - and nothing else, and no page, offers
 * either.
 */
import { describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { translate } from "@/lib/i18n";
import { componentRootSwapMenuItem, resolveComponentRootSwapMenuEntry } from "@/lib/ui-editor/context-menu/componentRootSwapMenu";
import { createComponentDocumentServiceAdapter, getComponentEditorSurfaceId } from "./componentEditorAdapter";

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = [], props?: Record<string, unknown>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 100, height: 40, visible: true, opacity: 1 }, ...(props ? { props } : {}) };
}

function project(frameChildren: string[]): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            { id: "page", name: "Page", host: "app", kind: "appSurface", designSize: { width: 1920, height: 1080 }, rootElementId: "pageRoot" },
        ],
        elements: { pageRoot: element("pageRoot", "nl.root", null, ["pageButton"]), pageButton: element("pageButton", "nl.button", "pageRoot") },
        components: [
            {
                id: "nav",
                name: "Nav",
                rootElementId: "frame",
                elements: {
                    frame: element("frame", "nl.container", null, frameChildren, { layoutKind: "free" }),
                    button: element("button", "nl.button", "frame", ["label"]),
                    label: element("label", "nl.text", "button"),
                    other: element("other", "nl.text", "frame"),
                },
            },
        ],
    };
}

function editor(frameChildren: string[]) {
    const doc = project(frameChildren);
    const calls: unknown[][] = [];
    const base = {
        getDocument: () => doc,
        getRevision: () => 1,
        getComponent: (id: string) => doc.components?.find(component => component.id === id),
        promoteComponentElementToRoot: (...args: unknown[]) => calls.push(["promote", ...args]),
        wrapComponentRoot: (...args: unknown[]) => {
            calls.push(["wrap", ...args]);
            return "wrapper";
        },
    } as unknown as UIDocumentService;
    const service = createComponentDocumentServiceAdapter(base, "nav");
    const stateService = { setUIElementSelection: vi.fn() } as unknown as UIEditorStateService;
    const surfaceId = getComponentEditorSurfaceId("nav");
    const entryFor = (elementId: string) => resolveComponentRootSwapMenuEntry({
        document: service.getDocument(),
        surfaceId,
        menuSelection: { editor: "ui", surfaceId, elementIds: [elementId], primaryId: elementId },
        documentService: service,
        stateService,
    });
    return { entryFor, calls, stateService, surfaceId };
}

describe("changing a component's root from its editor's menus", () => {
    it("offers Wrap in Container on the frame, and selects the new container", () => {
        const { entryFor, calls, stateService, surfaceId } = editor(["button"]);
        const entry = entryFor("frame");
        expect(entry?.kind).toBe("wrap");
        const [item] = componentRootSwapMenuItem(entry, () => {});
        expect(item).toMatchObject({ id: "wrap-root", label: translate("uiEditor.contextMenu.wrapRootInContainer") });
        item!.onClick!();
        expect(calls).toEqual([["wrap", "nav"]]);
        expect(stateService.setUIElementSelection).toHaveBeenCalledWith({ editor: "ui", surfaceId, elementIds: ["wrapper"], primaryId: "wrapper" });
    });

    it("offers Set as Root Element on the one element in the frame", () => {
        const { entryFor, calls } = editor(["button"]);
        const [item] = componentRootSwapMenuItem(entryFor("button"), () => {});
        expect(item).toMatchObject({ id: "set-as-root", disabled: false });
        item!.onClick!();
        expect(calls).toEqual([["promote", "nav", "button"]]);
    });

    it("greys it out, with the reason, when the element shares the frame", () => {
        const { entryFor } = editor(["button", "other"]);
        const [item] = componentRootSwapMenuItem(entryFor("button"), () => {});
        expect(item).toMatchObject({ disabled: true, tooltip: translate("uiEditor.contextMenu.setAsRootNotAlone") });
    });

    it("offers nothing deeper in, and nothing on a page", () => {
        const { entryFor } = editor(["button"]);
        expect(entryFor("label")).toBeNull();
        const page = project(["button"]);
        expect(resolveComponentRootSwapMenuEntry({
            document: page,
            surfaceId: "page",
            menuSelection: { editor: "ui", surfaceId: "page", elementIds: ["pageButton"], primaryId: "pageButton" },
            documentService: {} as UIDocumentService,
            stateService: {} as UIEditorStateService,
        })).toBeNull();
    });
});
