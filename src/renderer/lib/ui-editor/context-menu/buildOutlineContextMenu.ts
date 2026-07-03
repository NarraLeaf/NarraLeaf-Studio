import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { appendArrangeSubmenu } from "./appendArrangeSubmenu";
import type { BuildOutlineContextMenuInput } from "./types";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";

const ROOT = "nl.root";

export function buildOutlineContextMenu(input: BuildOutlineContextMenuInput): ContextMenuDef {
    const {
        rowElement,
        menuSelection,
        hasClipboard,
        widgetModules,
        documentService,
        actions,
        canAddToGroup,
        insertParentIdForRow,
    } = input;

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
        if (rowElement && insertParentIdForRow) {
            items.push({
                id: "paste-into",
                label: "Paste into container",
                onClick: () => {
                    actions.hideMenu();
                    actions.pasteIntoParent(insertParentIdForRow);
                },
            });
        }
    }

    if (!rowElement) {
        const insertSubmenu = widgetModules.map(mod => ({
            id: `outline-blank-insert-${mod.type}`,
            label: mod.displayName,
            onClick: () => {
                actions.hideMenu();
                actions.insertChildInOutline(mod.type);
            },
        }));
        if (insertSubmenu.length > 0) {
            items.push({
                id: "insert",
                label: "Insert",
                submenu: insertSubmenu,
            });
        }
        items.push(
            {
                id: "select-all",
                label: "Select all",
                onClick: () => {
                    actions.hideMenu();
                    actions.selectAll();
                },
            },
            {
                id: "expand-all",
                label: "Expand all",
                onClick: () => {
                    actions.hideMenu();
                    actions.expandAllBranches();
                },
            },
            {
                id: "collapse-all",
                label: "Collapse all",
                onClick: () => {
                    actions.hideMenu();
                    actions.collapseAllBranches();
                },
            },
        );
        return items;
    }

    const isRoot = rowElement.type === ROOT || isComponentEditorRootElement(rowElement);

    if (insertParentIdForRow) {
        const insertSubmenu = widgetModules.map(mod => ({
            id: `outline-insert-${mod.type}`,
            label: mod.displayName,
            onClick: () => {
                actions.hideMenu();
                actions.insertChildInOutline(mod.type);
            },
        }));
        items.push({
            id: "insert-child",
            label: "Insert child",
            submenu: insertSubmenu,
        });
        items.push({ separator: true, id: "sep-ins" });
    }

    const editableIds = (menuSelection?.elementIds ?? []).filter(id => {
        const el = input.document.elements[id];
        return el && el.type !== ROOT && !isComponentEditorRootElement(el);
    });
    const hasEditable = editableIds.length > 0;

    items.push(
        {
            id: "copy-element-id",
            label: "Copy Element ID",
            onClick: () => {
                actions.hideMenu();
                actions.copyElementId(rowElement.id);
            },
        },
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
    );

    appendArrangeSubmenu(items, {
        document: input.document,
        surfaceId: input.surfaceId,
        menuSelection: menuSelection,
        hideMenu: actions.hideMenu,
        arrange: actions.arrange,
    });

    items.push(
        { separator: true, id: "sep-row" },
        {
            id: "rename",
            label: "Rename…",
            disabled: isRoot,
            onClick: () => {
                actions.hideMenu();
                actions.renamePrimary();
            },
        },
        {
            id: "toggle-visible",
            label: rowElement.layout.visible === false ? "Show" : "Hide",
            disabled: isRoot,
            onClick: () => {
                actions.hideMenu();
                if (menuSelection && menuSelection.elementIds.length > 1) {
                    actions.setSelectedVisible(rowElement.layout.visible === false);
                } else {
                    documentService.updateElementLayout(rowElement.id, {
                        visible: rowElement.layout.visible === false ? true : false,
                    });
                }
            },
        },
    );

    if (hasEditable && menuSelection && menuSelection.elementIds.length > 1) {
        items.push(
            {
                id: "show-selected",
                label: "Show selected",
                onClick: () => {
                    actions.hideMenu();
                    actions.setSelectedVisible(true);
                },
            },
            {
                id: "hide-selected",
                label: "Hide selected",
                onClick: () => {
                    actions.hideMenu();
                    actions.setSelectedVisible(false);
                },
            },
        );
    }

    if (input.allowAddToComponentLibrary !== false) {
        items.push({
            id: "add-to-component-library",
            label: "Add to Component Library",
            disabled: !hasEditable,
            onClick: () => {
                actions.hideMenu();
                actions.addSelectionToComponentLibrary();
            },
        });
    }

    items.push({
        id: "delete",
        label: "Delete",
        disabled: !hasEditable,
        onClick: () => {
            actions.hideMenu();
            actions.delete();
        },
    });

    items.push({
        id: "add-to-group",
        label: "Add to group",
        disabled: !canAddToGroup,
        onClick: () => {
            actions.hideMenu();
            actions.addSelectionToLeaderGroup();
        },
    });

    if (menuSelection?.elementIds.length === 1) {
        const el = input.document.elements[menuSelection.elementIds[0]];
        if (el && el.type !== ROOT && !isComponentEditorRootElement(el)) {
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
