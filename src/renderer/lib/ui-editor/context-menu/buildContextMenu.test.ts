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
        insertType: vi.fn(),
        paste: vi.fn(),
        copy: vi.fn(),
        cut: vi.fn(),
        duplicate: vi.fn(),
        delete: vi.fn(),
        selectAll: vi.fn(),
        renamePrimary: vi.fn(),
        setSelectedVisible: vi.fn(),
        addSelectionToLeaderGroup: vi.fn(),
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
            canAddToGroup: false,
            allowAddToComponentLibrary: true,
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
            "show-selected",
            "hide-selected",
            "add-to-group",
        ]) {
            expect(findItem(items, id).disabled).toBe(true);
        }
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
            canAddToGroup: false,
            allowAddToComponentLibrary: true,
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
            "add-to-group",
        ]) {
            expect(findItem(items, id).disabled).toBe(true);
        }
        expect(findItem(items, "arrange").submenu?.every(item => item.disabled)).toBe(true);
    });
});
