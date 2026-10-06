import { addElementState, canAddElementState } from "@/lib/ui-editor/widget-modules/shared/appearance/elementStates";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { buildInsertWidgetSubmenu } from "./insertWidgetMenuItems";
import { componentRootSwapMenuItem } from "./componentRootSwapMenu";
import { appendArrangeSubmenu } from "./appendArrangeSubmenu";
import { appendAlignSubmenu } from "./appendAlignSubmenu";
import type { BuildCanvasContextMenuInput } from "./types";
import { isSurfaceRootElement } from "@/lib/ui-editor/commands/uiEditorSelection";
import { translate } from "@/lib/i18n";

const ROOT = "nl.root";

export function buildCanvasContextMenu(input: BuildCanvasContextMenuInput): ContextMenuDef {
    const { menuSelection, hasClipboard, widgetModules, documentService, actions, canGroup, canUngroup, insertBlockedReason } = input;
    const items: ContextMenuDef = [];

    if (hasClipboard) {
        items.push({
            id: "paste",
            label: translate("common.paste"),
            onClick: () => {
                actions.hideMenu();
                actions.paste();
            },
        });
    }

    const insertSubmenu = buildInsertWidgetSubmenu(widgetModules, "insert-", type => {
        actions.hideMenu();
        actions.insertType(type);
    });
    if (insertSubmenu.length > 0) {
        items.push({
            id: "insert",
            label: translate("uiEditor.contextMenu.insert"),
            submenu: insertSubmenu,
            disabled: insertBlockedReason != null,
            tooltip: insertBlockedReason ?? undefined,
        });
    }

    items.push({
        id: "select-all",
        label: translate("uiEditor.contextMenu.selectAll"),
        onClick: () => {
            actions.hideMenu();
            actions.selectAll();
        },
    });

    if (!menuSelection || menuSelection.elementIds.length === 0) {
        return items;
    }

    items.push({ separator: true, id: "sep-edit" });

    // What can be copied, cut, duplicated or deleted: never the surface itself - a page's root, or a
    // component's frame in its own editor.
    const editableIds = menuSelection.elementIds.filter(id => {
        const el = input.document.elements[id];
        return el != null && !isSurfaceRootElement(el);
    });
    const hasEditable = editableIds.length > 0;
    // What can be named and shown or hidden: anything but a page's root, the frame included.
    const hasLayer = menuSelection.elementIds.some(id => {
        const el = input.document.elements[id];
        return el != null && el.type !== ROOT;
    });

    items.push(
        {
            id: "copy",
            label: translate("common.copy"),
            disabled: !hasEditable,
            onClick: () => {
                actions.hideMenu();
                actions.copy();
            },
        },
        {
            id: "cut",
            label: translate("common.cut"),
            disabled: !hasEditable,
            onClick: () => {
                actions.hideMenu();
                actions.cut();
            },
        },
        {
            id: "duplicate",
            label: translate("common.duplicate"),
            disabled: !hasEditable,
            onClick: () => {
                actions.hideMenu();
                actions.duplicate();
            },
        },
        {
            id: "delete",
            label: translate("common.delete"),
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

    appendAlignSubmenu(items, {
        document: input.document,
        surfaceId: input.surfaceId,
        menuSelection,
        hideMenu: actions.hideMenu,
        align: actions.align,
    });

    if (menuSelection.elementIds.length === 1) {
        const only = menuSelection.elementIds[0];
        const el = input.document.elements[only];
        if (el) {
            items.push({
                id: "rename",
                label: translate("uiEditor.contextMenu.rename"),
                disabled: el.type === ROOT,
                onClick: () => {
                    actions.hideMenu();
                    actions.renamePrimary();
                },
            });
        }
    }

    items.push(...componentRootSwapMenuItem(input.rootSwap, actions.hideMenu));

    if (input.allowAddToComponentLibrary !== false) {
        items.push({
            id: "add-to-component-library",
            label: translate("uiEditor.contextMenu.addToComponentLibrary"),
            disabled: !hasEditable,
            onClick: () => {
                actions.hideMenu();
                actions.addSelectionToComponentLibrary();
            },
        });
    }

    items.push(
        { separator: true, id: "sep-vis" },
        {
            id: "show-selected",
            label: translate("common.show"),
            disabled: !hasLayer,
            onClick: () => {
                actions.hideMenu();
                actions.setSelectedVisible(true);
            },
        },
        {
            id: "hide-selected",
            label: translate("common.hide"),
            disabled: !hasLayer,
            onClick: () => {
                actions.hideMenu();
                actions.setSelectedVisible(false);
            },
        },
    );

    items.push(
        {
            id: "group",
            label: translate("uiEditor.contextMenu.group"),
            disabled: !canGroup,
            onClick: () => {
                actions.hideMenu();
                actions.groupSelection();
            },
        },
        {
            id: "ungroup",
            label: translate("uiEditor.contextMenu.ungroup"),
            disabled: !canUngroup,
            onClick: () => {
                actions.hideMenu();
                actions.ungroupSelection();
            },
        },
    );

    if (menuSelection.elementIds.length === 1) {
        const stateElement = input.document.elements[menuSelection.elementIds[0]];
        if (canAddElementState(input.document, stateElement)) {
            items.push({ separator: true, id: "sep-state" });
            items.push({
                id: "add-state",
                label: translate("uiEditor.contextMenu.addState"),
                onClick: () => {
                    actions.hideMenu();
                    addElementState(
                        documentService,
                        input.surfaceId,
                        stateElement.id,
                        UIEditorStateService.getInstance().getEnteredState()?.variantId ?? null,
                    );
                },
            });
        }
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
