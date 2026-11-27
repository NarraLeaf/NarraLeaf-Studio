import { describe, expect, it, vi } from "vitest";
import type { ContextMenuDef, ContextMenuItemDef } from "@/lib/components/elements/ContextMenu";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { buildCanvasContextMenu } from "./buildCanvasContextMenu";
import { buildOutlineContextMenu } from "./buildOutlineContextMenu";

function element(id: string, type: string, parentId: string | null = null, childrenIds: string[] = []): UIElement {
    return {
        id,
        type,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 100, height: 40 },
    };
}

function createDocument(): UIDocument {
    return {
        schemaVersion: 9,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "surface",
                name: "Surface",
                host: "app",
                kind: "appSurface",
                designSize: { width: 800, height: 600 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: element("root", "nl.root", null, ["child"]),
            child: element("child", "nl.container", "root"),
        },
    };
}

function findItem(items: ContextMenuDef, id: string): ContextMenuItemDef {
    const found = items.find(item => !("separator" in item) && item.id === id);
    if (!found || "separator" in found) {
        throw new Error(`Menu item not found: ${id}`);
    }
    return found;
}

function enabled(item: ContextMenuItemDef): boolean {
    return item.disabled !== true;
}

function noopActions() {
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
    };
}

describe("UI editor context menus", () => {
    it("shows root-only canvas actions explicitly disabled", () => {
        const doc = createDocument();
        const items = buildCanvasContextMenu({
            document: doc,
            surfaceId: "surface",
            menuSelection: {
                editor: "ui",
                surfaceId: "surface",
                elementIds: ["root"],
                primaryId: "root",
            },
            hasClipboard: false,
            widgetModules: [{ type: "nl.button", displayName: "Button" } as any],
            documentService: {} as any,
            actions: noopActions(),
            canGroup: false,
            canUngroup: false,
            allowAddToComponentLibrary: true,
            insertBlockedReason: null,
        });

        expect(enabled(findItem(items, "insert"))).toBe(true);
        expect(enabled(findItem(items, "select-all"))).toBe(true);
        for (const id of [
            "copy",
            "cut",
            "duplicate",
            "delete",
            "rename",
            "add-to-component-library",
            "hide-selected",
            "group",
            "ungroup",
        ]) {
            expect(findItem(items, id).disabled).toBe(true);
        }
        // Only the visibility row that would change something is offered: nothing here is hidden.
        expect(items.some(item => !("separator" in item) && item.id === "show-selected")).toBe(false);
        expect(findItem(items, "arrange").submenu?.every(item => item.disabled)).toBe(true);
    });

    it("shows root-only outline actions explicitly disabled while keeping child insertion enabled", () => {
        const doc = createDocument();
        const actions = {
            ...noopActions(),
            pasteIntoParent: vi.fn(),
            expandAllBranches: vi.fn(),
            collapseAllBranches: vi.fn(),
            insertChildInOutline: vi.fn(),
        };
        const items = buildOutlineContextMenu({
            document: doc,
            surfaceId: "surface",
            rowElement: doc.elements.root,
            menuSelection: {
                editor: "ui",
                surfaceId: "surface",
                elementIds: ["root"],
                primaryId: "root",
            },
            hasClipboard: true,
            widgetModules: [{ type: "nl.button", displayName: "Button" } as any],
            documentService: { updateElementLayout: vi.fn() } as any,
            actions,
            canGroup: false,
            canUngroup: false,
            allowAddToComponentLibrary: true,
            insertBlockedReason: null,
            insertParentIdForRow: "root",
        });

        expect(enabled(findItem(items, "paste"))).toBe(true);
        expect(enabled(findItem(items, "paste-into"))).toBe(true);
        expect(enabled(findItem(items, "insert-child"))).toBe(true);
        for (const id of [
            "copy",
            "cut",
            "duplicate",
            "rename",
            "toggle-visible",
            "delete",
            "add-to-component-library",
            "group",
            "ungroup",
        ]) {
            expect(findItem(items, id).disabled).toBe(true);
        }
        expect(findItem(items, "arrange").submenu?.every(item => item.disabled)).toBe(true);
    });

    /**
     * Identifiers are Developer options' business now (`lib/developer`), appended by the menu's host
     * after this builder has run. The outline used to carry a Copy Element ID row of its own, which
     * would be a second, always-on copy of the same action sitting above the section.
     */
    it("leaves identifier rows to the developer section", () => {
        const doc = createDocument();
        const actions = {
            ...noopActions(),
            pasteIntoParent: vi.fn(),
            expandAllBranches: vi.fn(),
            collapseAllBranches: vi.fn(),
            insertChildInOutline: vi.fn(),
        };
        const items = buildOutlineContextMenu({
            document: doc,
            surfaceId: "surface",
            rowElement: doc.elements.child,
            menuSelection: {
                editor: "ui",
                surfaceId: "surface",
                elementIds: ["child"],
                primaryId: "child",
            },
            hasClipboard: false,
            widgetModules: [{ type: "nl.button", displayName: "Button" } as any],
            documentService: { updateElementLayout: vi.fn() } as any,
            actions,
            canGroup: false,
            canUngroup: false,
            allowAddToComponentLibrary: true,
            insertBlockedReason: null,
            insertParentIdForRow: "child",
        });

        expect(items.some(item => !("separator" in item) && item.id.includes("-id"))).toBe(false);
        expect(enabled(findItem(items, "copy"))).toBe(true);
    });

    it("lists every layer under the pointer under Select Layer, and selects the one picked", () => {
        const doc = createDocument();
        const selectLayer = vi.fn();
        const hideMenu = vi.fn();
        const items = buildCanvasContextMenu({
            document: doc,
            surfaceId: "surface",
            menuSelection: null,
            hasClipboard: false,
            widgetModules: [],
            documentService: {} as any,
            actions: { ...noopActions(), hideMenu },
            canGroup: false,
            canUngroup: false,
            insertBlockedReason: null,
            layersAtPoint: [
                { elementId: "cover", label: "Cover", depth: 1, selected: false },
                { elementId: "child", label: "Child", depth: 2, selected: true },
            ],
            selectLayer,
        });
        const row = findItem(items, "select-layer");
        expect(row.submenu?.map(item => item.label)).toEqual(["Cover", "\u2003\u2713 Child"]);
        row.submenu?.[1].onClick?.();
        expect(hideMenu).toHaveBeenCalled();
        expect(selectLayer).toHaveBeenCalledWith("child");
    });

    it("leaves Select Layer out when there is only one layer to choose", () => {
        const doc = createDocument();
        const items = buildCanvasContextMenu({
            document: doc,
            surfaceId: "surface",
            menuSelection: null,
            hasClipboard: false,
            widgetModules: [],
            documentService: {} as any,
            actions: noopActions(),
            canGroup: false,
            canUngroup: false,
            insertBlockedReason: null,
            layersAtPoint: [{ elementId: "child", label: "Child", depth: 1, selected: false }],
            selectLayer: vi.fn(),
        });
        expect(items.some(item => !("separator" in item) && item.id === "select-layer")).toBe(false);
    });
});
