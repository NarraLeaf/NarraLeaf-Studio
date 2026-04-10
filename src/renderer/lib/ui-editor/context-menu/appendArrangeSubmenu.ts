import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import {
    getUiEditorArrangeAvailability,
    type UiEditorArrangeOp,
} from "@/lib/ui-editor/commands/uiEditorArrange";

const ROOT = "nl.root";

function hasEditableArrangeTarget(document: UIDocument, menuSelection: UIElementSelection | null): boolean {
    if (!menuSelection || menuSelection.elementIds.length === 0) {
        return false;
    }
    return menuSelection.elementIds.some(id => {
        const el = document.elements[id];
        return el != null && el.type !== ROOT;
    });
}

/**
 * Appends a separator and the Arrange submenu when the selection includes at least one non-root element.
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
    if (!hasEditableArrangeTarget(document, menuSelection)) {
        return;
    }
    const av = getUiEditorArrangeAvailability(document, surfaceId, menuSelection);
    items.push({ separator: true, id: "sep-arrange" });
    items.push({
        id: "arrange",
        label: "Arrange",
        submenu: [
            {
                id: "arrange-bring-front",
                label: "Bring to front",
                disabled: !av.bringToFront,
                onClick: () => {
                    hideMenu();
                    arrange("bringToFront");
                },
            },
            {
                id: "arrange-send-back",
                label: "Send to back",
                disabled: !av.sendToBack,
                onClick: () => {
                    hideMenu();
                    arrange("sendToBack");
                },
            },
            {
                id: "arrange-bring-forward",
                label: "Bring forward",
                disabled: !av.bringForward,
                onClick: () => {
                    hideMenu();
                    arrange("bringForward");
                },
            },
            {
                id: "arrange-send-backward",
                label: "Send backward",
                disabled: !av.sendBackward,
                onClick: () => {
                    hideMenu();
                    arrange("sendBackward");
                },
            },
        ],
    });
}
