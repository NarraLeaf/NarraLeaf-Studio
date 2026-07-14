import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import {
    getUiEditorArrangeAvailability,
    type UiEditorArrangeOp,
} from "@/lib/ui-editor/commands/uiEditorArrange";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";
import { translate } from "@/lib/i18n";

const ROOT = "nl.root";

function hasEditableArrangeTarget(document: UIDocument, menuSelection: UIElementSelection | null): boolean {
    if (!menuSelection || menuSelection.elementIds.length === 0) {
        return false;
    }
    return menuSelection.elementIds.some(id => {
        const el = document.elements[id];
        return el != null && el.type !== ROOT && !isComponentEditorRootElement(el);
    });
}

function hasAnySelection(menuSelection: UIElementSelection | null): boolean {
    return Boolean(menuSelection && menuSelection.elementIds.length > 0);
}

/**
 * Appends a separator and the Arrange submenu when there is a selection.
 * Root-only selections keep the submenu visible with all operations disabled.
 */
export function appendArrangeSubmenu(
    items: ContextMenuDef,
    input: {
        document: UIDocument;
        surfaceId: string;
        menuSelection: UIElementSelection | null;
        hideMenu: () => void;
        arrange: (op: UiEditorArrangeOp) => void;
    },
): void {
    const { document, surfaceId, menuSelection, hideMenu, arrange } = input;
    if (!hasAnySelection(menuSelection)) {
        return;
    }
    const hasEditable = hasEditableArrangeTarget(document, menuSelection);
    const av = hasEditable
        ? getUiEditorArrangeAvailability(document, surfaceId, menuSelection)
        : {
              bringToFront: false,
              sendToBack: false,
              bringForward: false,
              sendBackward: false,
          };
    items.push({ separator: true, id: "sep-arrange" });
    items.push({
        id: "arrange",
        label: translate("uiEditor.contextMenu.arrange.label"),
        submenu: [
            {
                id: "arrange-bring-front",
                label: translate("uiEditor.contextMenu.arrange.bringToFront"),
                disabled: !av.bringToFront,
                onClick: () => {
                    hideMenu();
                    arrange("bringToFront");
                },
            },
            {
                id: "arrange-send-back",
                label: translate("uiEditor.contextMenu.arrange.sendToBack"),
                disabled: !av.sendToBack,
                onClick: () => {
                    hideMenu();
                    arrange("sendToBack");
                },
            },
            {
                id: "arrange-bring-forward",
                label: translate("uiEditor.contextMenu.arrange.bringForward"),
                disabled: !av.bringForward,
                onClick: () => {
                    hideMenu();
                    arrange("bringForward");
                },
            },
            {
                id: "arrange-send-backward",
                label: translate("uiEditor.contextMenu.arrange.sendBackward"),
                disabled: !av.sendBackward,
                onClick: () => {
                    hideMenu();
                    arrange("sendBackward");
                },
            },
        ],
    });
}
