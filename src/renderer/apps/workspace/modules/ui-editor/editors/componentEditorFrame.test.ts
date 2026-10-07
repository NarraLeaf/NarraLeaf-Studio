/**
 * A component's root, in the editor for that component, is the frame the canvas is drawn at - for
 * every component, whatever its root is called.
 *
 * It used to be told by name: a root named exactly "Root" was hidden and could not be selected, and
 * any other root was an ordinary element. "Root" is the name a new component gets in English, so in
 * English a new component could not be resized at all, while the same component made in Chinese
 * ("根节点") or Japanese ("ルート"), and every component in the shipped template, could - and could
 * also be copied, duplicated, deleted in the interface (the document quietly refused) or pasted
 * beside. Every root now gets the same thing: selected and sized like a container, never moved,
 * removed, duplicated, reordered or put inside anything, and nothing lands beside it.
 *
 * The documents below are built by the real adapter, so what is tested is what the editor draws.
 */
import { describe, expect, it, vi } from "vitest";
import type { ContextMenuDef, ContextMenuItemDef } from "@/lib/components/elements/ContextMenu";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { canUngroupContainer } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";
import { buildUiEditorClipboardPayload } from "@/lib/ui-editor/commands/uiEditorClipboard";
import {
    resolvePasteTargetAfterSelection,
    uiEditorDeleteSelection,
    uiEditorDuplicateSelection,
    uiEditorSelectAllInSurface,
} from "@/lib/ui-editor/commands/uiEditorCommands";
import { canGroupSelection } from "@/lib/ui-editor/commands/uiEditorSelection";
import { planGroupElements } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { getUiEditorArrangeAvailability } from "@/lib/ui-editor/commands/uiEditorArrange";
import { getUiEditorAlignAvailability } from "@/lib/ui-editor/commands/uiEditorAlign";
import { buildCanvasContextMenu } from "@/lib/ui-editor/context-menu/buildCanvasContextMenu";
import { buildOutlineContextMenu } from "@/lib/ui-editor/context-menu/buildOutlineContextMenu";
import { createComponentDocumentServiceAdapter, getComponentEditorRootId, getComponentEditorSurfaceId } from "./componentEditorAdapter";

/** The names a root arrives with: new components in English, Chinese and Japanese, and a template's. */
const ROOT_NAMES = ["Root", "根节点", "ルート", "Save slot"] as const;

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = [], name?: string): UIElement {
    return {
        id,
        type,
        parentId,
        childrenIds,
        ...(name ? { name } : {}),
        layout: { x: 10, y: 10, width: 120, height: 40, visible: true, opacity: 1 },
    };
}

function projectWithComponent(rootName: string): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            { id: "page", name: "Page", host: "app", kind: "appSurface", designSize: { width: 1920, height: 1080 }, rootElementId: "pageRoot" },
        ],
        elements: {
            pageRoot: element("pageRoot", "nl.root", null, ["pageButton"]),
            pageButton: element("pageButton", "nl.button", "pageRoot"),
        },
        components: [
            {
                id: "card",
                name: "Card",
                rootElementId: "frame",
                elements: {
                    frame: { ...element("frame", "nl.container", null, ["panel", "label"], rootName), layout: { x: 0, y: 0, width: 456, height: 348 } },
                    panel: element("panel", "nl.container", "frame", ["icon"]),
                    icon: element("icon", "nl.image", "panel"),
                    label: element("label", "nl.text", "frame"),
                },
            },
        ],
    };
}

/** The adapter over a base service that records what reaches the stored definition. */
function componentEditor(rootName: string) {
    const project = projectWithComponent(rootName);
    const calls: Array<[string, ...unknown[]]> = [];
    const base = {
        getDocument: () => project,
        getRevision: () => 1,
        getComponent: (componentId: string) => project.components?.find(component => component.id === componentId),
        deleteComponentElements: (...args: unknown[]) => calls.push(["delete", ...args]),
        createComponentElement: (...args: unknown[]) => {
            calls.push(["create", ...args]);
            return element("created", String(args[2]), String(args[1]));
        },
        moveComponentElements: (...args: unknown[]) => {
            calls.push(["move", ...args]);
            return { ok: true };
        },
        pasteComponentClipboardPayload: (...args: unknown[]) => {
            calls.push(["paste", ...args]);
            return { ok: true, newRootIds: [] };
        },
    } as unknown as UIDocumentService;
    const service = createComponentDocumentServiceAdapter(base, "card");
    return { service, document: service.getDocument(), calls, surfaceId: getComponentEditorSurfaceId("card") };
}

function selection(surfaceId: string, elementIds: string[]): UIElementSelection {
    return { editor: "ui", surfaceId, elementIds, primaryId: elementIds[elementIds.length - 1] };
}

function recordingState(initial: UIElementSelection) {
    let current: unknown = { type: "element", data: initial };
    const state = {
        getSelection: () => current,
        setSelection: (next: unknown) => {
            current = next;
        },
        setUIElementSelection: (data: UIElementSelection) => {
            current = { type: "element", data };
        },
    } as unknown as UIEditorStateService;
    return { state, read: () => current };
}

function findItem(items: ContextMenuDef, id: string): ContextMenuItemDef {
    const found = items.find(item => !("separator" in item) && item.id === id);
    if (!found || "separator" in found) {
        throw new Error(`Menu item not found: ${id}`);
    }
    return found;
}

function menuActions() {
    return {
        hideMenu: vi.fn(),
        arrange: vi.fn(),
        align: vi.fn(),
        insertType: vi.fn(),
        paste: vi.fn(),
        copy: vi.fn(),
        cut: vi.fn(),
        duplicate: vi.fn(),
        delete: vi.fn(),
        selectAll: vi.fn(),
        renamePrimary: vi.fn(),
        setSelectedVisible: vi.fn(),
        groupSelection: vi.fn(),
        ungroupSelection: vi.fn(),
        addSelectionToComponentLibrary: vi.fn(),
        pasteIntoParent: vi.fn(),
        expandAllBranches: vi.fn(),
        collapseAllBranches: vi.fn(),
        insertChildInOutline: vi.fn(),
    };
}

describe.each(ROOT_NAMES)("a component whose root is called %s", rootName => {
    it("has its root as the frame, and nothing else", () => {
        const { document } = componentEditor(rootName);

        expect(isComponentEditorRootElement(document.elements.frame)).toBe(true);
        for (const id of ["panel", "icon", "label", getComponentEditorRootId("card")]) {
            expect(isComponentEditorRootElement(document.elements[id])).toBe(false);
        }
        // Told by position, not by a mark written onto the element that a copy could carry away.
        expect(document.elements.frame?.extra).toBeUndefined();
    });

    it("does not delete the frame, and leaves the selection alone when asked to", () => {
        const { service, surfaceId, calls } = componentEditor(rootName);
        const frameOnly = selection(surfaceId, ["frame"]);
        const { state, read } = recordingState(frameOnly);

        expect(uiEditorDeleteSelection(service, state, surfaceId, frameOnly)).toBe(false);
        expect(calls).toEqual([]);
        expect(read()).toEqual({ type: "element", data: frameOnly });
    });

    it("deletes what is inside the frame when the frame is selected with it", () => {
        const { service, surfaceId, calls } = componentEditor(rootName);
        const both = selection(surfaceId, ["frame", "label"]);

        expect(uiEditorDeleteSelection(service, recordingState(both).state, surfaceId, both)).toBe(true);
        expect(calls).toEqual([["delete", "card", ["label"]]]);
    });

    it("does not copy or duplicate the frame, and copies what is selected inside it", () => {
        const { service, document, surfaceId } = componentEditor(rootName);
        const copy = (ids: string[]) =>
            buildUiEditorClipboardPayload({ document, surfaceId, selectedElementIds: ids, getWidgetMainBlueprint: () => undefined });

        expect(copy(["frame"])).toBeNull();
        expect(copy(["frame", "panel"])?.topLevelElementIds).toEqual(["panel"]);
        const frameOnly = selection(surfaceId, ["frame"]);
        expect(uiEditorDuplicateSelection(service, {} as never, recordingState(frameOnly).state, surfaceId, frameOnly)).toBe(false);
    });

    it("selects everything inside the frame on Select all, and not the frame", () => {
        const { service, surfaceId } = componentEditor(rootName);
        const { state, read } = recordingState(selection(surfaceId, ["frame"]));

        uiEditorSelectAllInSurface(service, state, surfaceId);

        expect((read() as { data: UIElementSelection }).data.elementIds).toEqual(["panel", "icon", "label"]);
    });

    it("pastes and inserts into the frame, never beside it", () => {
        const { service, document, surfaceId, calls } = componentEditor(rootName);
        const virtualRootId = getComponentEditorRootId("card");

        expect(resolvePasteTargetAfterSelection(document, surfaceId, selection(surfaceId, ["frame"]))).toEqual({
            parentId: virtualRootId,
            beforeChildId: null,
        });
        // The surface's own root, as a target, is the frame.
        service.createElement(virtualRootId, "nl.text");
        service.pasteClipboardPayload(surfaceId, virtualRootId, null, { elements: {}, topLevelElementIds: [] } as never);
        expect(calls.map(call => [call[0], call[2]])).toEqual([
            ["create", "frame"],
            ["paste", "frame"],
        ]);
    });

    it("never moves the frame into a group, reorders it, aligns it or dissolves it", () => {
        const { service, document, surfaceId } = componentEditor(rootName);

        expect(planGroupElements(document, surfaceId, ["panel", "frame", "label"])?.movers).toEqual(["panel", "label"]);
        expect(canGroupSelection(document, surfaceId, selection(surfaceId, ["frame"]))).toBe(false);
        expect(canUngroupContainer(document, surfaceId, "frame")).toBe(false);
        expect(Object.values(getUiEditorArrangeAvailability(document, surfaceId, selection(surfaceId, ["frame"])))).not.toContain(true);
        expect(Object.values(getUiEditorAlignAvailability(document, surfaceId, selection(surfaceId, ["frame"])))).not.toContain(true);
        expect(service.moveElementsInSurface(surfaceId, ["frame"], "panel", null)).toEqual({ ok: false, reason: "invalid_movers" });
    });

    it("offers the frame a name and visibility in its menus, and nothing that would remove or copy it", () => {
        const { service, document, surfaceId } = componentEditor(rootName);
        const menuSelection = selection(surfaceId, ["frame"]);
        const shared = {
            document,
            surfaceId,
            menuSelection,
            hasClipboard: true,
            widgetModules: [{ type: "nl.text", displayName: "Text" } as never],
            documentService: service,
            canGroup: false,
            canUngroup: false,
            allowAddToComponentLibrary: false,
            insertBlockedReason: null,
        };
        const canvas = buildCanvasContextMenu({ ...shared, actions: menuActions() });
        const outline = buildOutlineContextMenu({
            ...shared,
            actions: menuActions(),
            rowElement: document.elements.frame!,
            insertParentIdForRow: "frame",
        });

        for (const id of ["copy", "cut", "duplicate", "delete"]) {
            expect(findItem(canvas, id).disabled).toBe(true);
            expect(findItem(outline, id).disabled).toBe(true);
        }
        for (const id of ["rename", "show-selected", "hide-selected"]) {
            expect(findItem(canvas, id).disabled).not.toBe(true);
        }
        for (const id of ["rename", "toggle-visible", "insert-child"]) {
            expect(findItem(outline, id).disabled).not.toBe(true);
        }
    });

    it("takes a new size for the frame", () => {
        const project = projectWithComponent(rootName);
        const writes: unknown[] = [];
        const base = {
            getDocument: () => project,
            getRevision: () => 1,
            getComponent: () => project.components![0],
            updateComponentElementLayout: (...args: unknown[]) => writes.push(args),
        } as unknown as UIDocumentService;

        createComponentDocumentServiceAdapter(base, "card").updateElementLayout("frame", { width: 500, height: 360 });

        // The trailing options are the write's own (`skipHistory`), passed on as the editor gave them.
        expect(writes).toEqual([["card", "frame", { width: 500, height: 360 }, {}]]);
    });
});

describe("outside a component editor", () => {
    it("is never the frame: a page's elements, and a component's root as the project stores it", () => {
        const project = projectWithComponent("Root");

        expect(isComponentEditorRootElement(project.elements.pageButton)).toBe(false);
        expect(isComponentEditorRootElement(project.components![0]!.elements.frame)).toBe(false);
    });
});
