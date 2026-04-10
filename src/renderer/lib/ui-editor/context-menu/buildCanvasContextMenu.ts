import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { appendArrangeSubmenu } from "./appendArrangeSubmenu";
import type { BuildCanvasContextMenuInput } from "./types";

const ROOT = "nl.root";

export function buildCanvasContextMenu(input: BuildCanvasContextMenuInput): ContextMenuDef {
    const { menuSelection, hasClipboard, widgetModules, documentService, actions, canAddToGroup } = input;
    const items: ContextMenuDef = [];

    if (hasClipboard) {
        items.push({
            id: "paste",
            label: "Paste",
            onClick: () => {
                actions.hideMenu();
                actions.paste();
            },
        });
    }

    const insertSubmenu = widgetModules.map(mod => ({
        id: `insert-${mod.type}`,
        label: mod.displayName,
        onClick: () => {
            actions.hideMenu();
            actions.insertType(mod.type);
        },
    }));
    if (insertSubmenu.length > 0) {
        items.push({
            id: "insert",
            label: "Insert",
            submenu: insertSubmenu,
        });
    }

    items.push({
        id: "select-all",
        label: "Select all",
        onClick: () => {
            actions.hideMenu();
            actions.selectAll();
        },
    });

    if (!menuSelection || menuSelection.elementIds.length === 0) {
        return items;
    }

    items.push({ separator: true, id: "sep-edit" });

    const editableIds = menuSelection.elementIds.filter(id => {
        const el = input.document.elements[id];
        return el && el.type !== ROOT;
    });
    const hasEditable = editableIds.length > 0;

    items.push(
        {
            id: "copy",
            label: "Copy",
            disabled: !hasEditable,
            onClick: () => {
                actions.hideMenu();
                actions.copy();
            },
        },
        {
            id: "cut",
            label: "Cut",
            disabled: !hasEditable,
            onClick: () => {
                actions.hideMenu();
                actions.cut();
            },
        },
        {
            id: "duplicate",
            label: "Duplicate",
            disabled: !hasEditable,
            onClick: () => {
                actions.hideMenu();
                actions.duplicate();
            },
        },
        {
            id: "delete",
            label: "Delete",
            disabled: !hasEditable,
            onClick: () => {
                actions.hideMenu();
                actions.delete();
            },
        },
    );

    appendArrangeSubmenu(items, {
        document: input.document,
        surfaceId: input.surfaceId,
        menuSelection,
        hideMenu: actions.hideMenu,
        arrange: actions.arrange,
    });

    if (menuSelection.elementIds.length === 1) {
        const only = menuSelection.elementIds[0];
        const el = input.document.elements[only];
        if (el && el.type !== ROOT) {
            items.push({
                id: "rename",
                label: "Rename…",
                onClick: () => {
                    actions.hideMenu();
                    actions.renamePrimary();
                },
            });
        }
    }

    if (hasEditable) {
        items.push(
            { separator: true, id: "sep-vis" },
            {
                id: "show-selected",
                label: "Show",
                onClick: () => {
                    actions.hideMenu();
                    actions.setSelectedVisible(true);
                },
            },
            {
                id: "hide-selected",
                label: "Hide",
                onClick: () => {
                    actions.hideMenu();
                    actions.setSelectedVisible(false);
                },
            },
        );
    }

    if (canAddToGroup) {
        items.push({
            id: "add-to-group",
            label: "Add to group",
            onClick: () => {
                actions.hideMenu();
                actions.addSelectionToLeaderGroup();
            },
        });
    }

    if (menuSelection.elementIds.length === 1) {
        const el = input.document.elements[menuSelection.elementIds[0]];
        if (el) {
            const mod = widgetModuleRegistry.get(el.type);
            const extra = mod?.createContextMenuItems?.({
                element: el,
                documentService,
                surfaceId: input.surfaceId,
            });
            if (extra && extra.length > 0) {
                items.push({ separator: true, id: "sep-widget" });
                for (const x of extra) {
                    const prev = x.onClick;
                    items.push({
                        ...x,
                        onClick: () => {
                            actions.hideMenu();
                            prev?.();
                        },
                    });
                }
            }
        }
    }

    return items;
}
