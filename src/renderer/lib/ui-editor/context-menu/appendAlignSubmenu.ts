import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import {
  getUiEditorAlignAvailability,
  type UiEditorAlignOp
} from "@/lib/ui-editor/commands/uiEditorAlign";
import { translate } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";

/**
 * Appends the Align and Distribute submenus when there is a selection.
 *
 * Same shape as {@link appendArrangeSubmenu}: hidden with no selection, otherwise visible with each
 * row disabled on its own availability, so a selection that cannot be aligned still shows where the
 * commands live.
 */
export function appendAlignSubmenu(
  items: ContextMenuDef,
  input: {
    document: UIDocument;
    surfaceId: string;
    menuSelection: UIElementSelection | null;
    hideMenu: () => void;
    align: (op: UiEditorAlignOp) => void;
  }
): void {
  const { document, surfaceId, menuSelection, hideMenu, align } = input;
  if (!menuSelection || menuSelection.elementIds.length === 0) {
    return;
  }
  const av = getUiEditorAlignAvailability(document, surfaceId, menuSelection);
  const row = (id: string, op: UiEditorAlignOp, labelKey: TranslationKey) => ({
    id,
    label: translate(labelKey),
    disabled: !av[op],
    onClick: () => {
      hideMenu();
      align(op);
    }
  });

  items.push({
    id: "align",
    label: translate("uiEditor.align.label"),
    submenu: [
      row("align-left", "left", "uiEditor.align.left"),
      row("align-horizontal-center", "horizontalCenter", "uiEditor.align.horizontalCenter"),
      row("align-right", "right", "uiEditor.align.right"),
      row("align-top", "top", "uiEditor.align.top"),
      row("align-vertical-center", "verticalCenter", "uiEditor.align.verticalCenter"),
      row("align-bottom", "bottom", "uiEditor.align.bottom")
    ]
  });
  items.push({
    id: "distribute",
    label: translate("uiEditor.align.distribute"),
    submenu: [
      row("distribute-horizontal", "distributeHorizontal", "uiEditor.align.distributeHorizontal"),
      row("distribute-vertical", "distributeVertical", "uiEditor.align.distributeVertical")
    ]
  });
}
