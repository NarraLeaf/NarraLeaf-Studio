/**
 * What can be inserted where, in the places a component makes awkward.
 *
 * A component made from one element has that element for a root - a text input, say - and its editor
 * then has nowhere to put anything. The editor's made-up `nl.root` above the definition used to say
 * yes to every insert anyway, and the definition refused each one: Insert Child and the insert bar
 * stayed live and did nothing. Likewise the insert tool is the workspace's, so a component armed on a
 * page stayed armed in a component's own editor, where definitions do not nest and the drag threw.
 *
 * The documents are built by the real adapter, so what is tested is what the editor reads.
 */
import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { translate } from "@/lib/i18n";
import { describeInsertRefusal, describeSurfaceInsertRefusal } from "@/lib/ui-editor/context-menu/insertRefusal";
import { buildOutlineContextMenu } from "@/lib/ui-editor/context-menu/buildOutlineContextMenu";
import { buildCanvasContextMenu } from "@/lib/ui-editor/context-menu/buildCanvasContextMenu";
import type { ContextMenuDef, ContextMenuItemDef } from "@/lib/components/elements/ContextMenu";
import {
    insertToolCanPlace,
    parentTakesNewElement,
    resolveNewElementParent,
} from "@/lib/ui-editor/tree/resolveAddTarget";
import {
    resolveNearestInsertParentInSurface,
    resolveSurfaceInsertRefusal,
} from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { createComponentDocumentServiceAdapter, getComponentEditorSurfaceId } from "./componentEditorAdapter";

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = [], extra?: UIElement["extra"]): UIElement {
    return {
        id,
        type,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 300, height: 48, visible: true, opacity: 1 },
        ...(extra ? { extra } : {}),
    };
}

function project(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            { id: "page", name: "Page", host: "app", kind: "appSurface", designSize: { width: 1920, height: 1080 }, rootElementId: "pageRoot" },
        ],
        elements: {
            pageRoot: element("pageRoot", "nl.root", null, ["nameField", "panel", "placed"]),
            nameField: element("nameField", "nl.textInput", "pageRoot"),
            panel: element("panel", "nl.container", "pageRoot"),
            placed: element("placed", "nl.container", "pageRoot", [], { componentLink: { componentId: "card", linked: true } }),
        },
        components: [
            {
                id: "nameInput",
                name: "Name input",
                rootElementId: "field",
                elements: { field: element("field", "nl.textInput", null) },
            },
            {
                id: "card",
                name: "Card",
                rootElementId: "frame",
                elements: {
                    frame: element("frame", "nl.container", null, ["label"]),
                    label: element("label", "nl.text", "frame"),
                },
            },
        ],
    };
}

function componentEditor(componentId: string) {
    const doc = project();
    const base = {
        getDocument: () => doc,
        getRevision: () => 1,
        getComponent: (id: string) => doc.components?.find(component => component.id === id),
    } as unknown as UIDocumentService;
    const service = createComponentDocumentServiceAdapter(base, componentId);
    return { document: service.getDocument(), surfaceId: getComponentEditorSurfaceId(componentId) };
}

function findItem(items: ContextMenuDef, id: string): ContextMenuItemDef {
    const item = items.find(entry => !("separator" in entry) && entry.id === id);
    if (!item || "separator" in item) {
        throw new Error(`menu item ${id} not found`);
    }
    return item;
}

const noop = () => {};
const actions = {
    hideMenu: noop, arrange: noop, align: noop, insertType: noop, paste: noop, copy: noop, cut: noop,
    duplicate: noop, delete: noop, selectAll: noop, renamePrimary: noop, setSelectedVisible: noop,
    groupSelection: noop, ungroupSelection: noop, addSelectionToComponentLibrary: noop,
    pasteIntoParent: noop, expandAllBranches: noop, collapseAllBranches: noop, insertChildInOutline: noop,
};

/** The name the refusal gives a text input: its module's, or the bare type before modules are registered. */
const textInputName = () => widgetModuleRegistry.get("nl.textInput")?.displayName ?? "nl.textInput";

describe("inserting into a component whose root holds no children", () => {
    it("refuses on the whole surface, and names the root that refuses", () => {
        const { document, surfaceId } = componentEditor("nameInput");
        expect(resolveSurfaceInsertRefusal(document, surfaceId)?.id).toBe("field");
        expect(describeSurfaceInsertRefusal(document, surfaceId)).toBe(
            translate("uiEditor.contextMenu.cannotHoldChildren", { name: textInputName() }),
        );
        // Nothing to walk up to: the made-up root answers for the definition's root.
        expect(resolveNearestInsertParentInSurface(document, surfaceId, "field")).toBeNull();
        expect(resolveNewElementParent(document, surfaceId, null)).toBeNull();
        expect(resolveNewElementParent(document, surfaceId, "field")).toBeNull();
        expect(insertToolCanPlace(document, surfaceId, {})).toBe(false);
    });

    it("greys out Insert Child on the root row and Insert on the blank outline and canvas, with the reason", () => {
        const { document, surfaceId } = componentEditor("nameInput");
        const reason = describeSurfaceInsertRefusal(document, surfaceId);
        const shared = {
            document,
            surfaceId,
            menuSelection: null,
            hasClipboard: false,
            widgetModules: [{ type: "nl.text", displayName: "Text" } as never],
            documentService: {} as never,
            canGroup: false,
            canUngroup: false,
            allowAddToComponentLibrary: false,
            actions,
        };
        const row = buildOutlineContextMenu({
            ...shared,
            rowElement: document.elements.field!,
            insertParentIdForRow: resolveNearestInsertParentInSurface(document, surfaceId, "field"),
            insertBlockedReason: describeInsertRefusal(document, document.elements.field!),
        });
        expect(findItem(row, "insert-child")).toMatchObject({ disabled: true, tooltip: reason });
        const blank = buildOutlineContextMenu({ ...shared, rowElement: null, insertParentIdForRow: null, insertBlockedReason: reason });
        expect(findItem(blank, "insert")).toMatchObject({ disabled: true, tooltip: reason });
        const canvas = buildCanvasContextMenu({ ...shared, insertBlockedReason: reason });
        expect(findItem(canvas, "insert")).toMatchObject({ disabled: true, tooltip: reason });
    });

    it("leaves a component whose root is a container as it was", () => {
        const { document, surfaceId } = componentEditor("card");
        expect(resolveSurfaceInsertRefusal(document, surfaceId)).toBeNull();
        expect(parentTakesNewElement(document, document.elements.frame!)).toBe(true);
        expect(resolveNewElementParent(document, surfaceId, "label")).toBe("frame");
        expect(insertToolCanPlace(document, surfaceId, { componentId: undefined })).toBe(true);
    });
});

describe("a component armed on a page", () => {
    it("can be placed on a page, never on a component's own canvas", () => {
        const page = project();
        expect(insertToolCanPlace(page, "page", { componentId: "card" })).toBe(true);
        const { document, surfaceId } = componentEditor("card");
        expect(insertToolCanPlace(document, surfaceId, { componentId: "nameInput" })).toBe(false);
    });
});

describe("Insert Child names the row it was opened on", () => {
    it("is refused by a row that holds no children, rather than inserting beside it", () => {
        const page = project();
        expect(describeInsertRefusal(page, page.elements.nameField!)).toBe(
            translate("uiEditor.contextMenu.cannotHoldChildren", { name: textInputName() }),
        );
        expect(describeInsertRefusal(page, page.elements.panel!)).toBeNull();
        expect(describeInsertRefusal(page, page.elements.pageRoot!)).toBeNull();
    });

    it("is refused by a placed component, whose contents are its definition's", () => {
        const page = project();
        expect(describeInsertRefusal(page, page.elements.placed!)).toBe(translate("uiEditor.contextMenu.linkedInstanceContents"));
    });
});
