import { useCallback, useMemo, type ComponentType } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter
} from "lucide-react";
import type { TranslationKey } from "@shared/i18n";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { useTranslation } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/app/platform";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import { formatKeybinding } from "@/lib/workspace/services/ui/KeybindingService";
import { getKeybindingCatalogEntry } from "@/lib/workspace/services/ui/keybindingCatalog";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import {
  getUiEditorAlignAvailability,
  uiEditorAlign,
  type UiEditorAlignAvailability,
  type UiEditorAlignOp
} from "@/lib/ui-editor/commands/uiEditorAlign";
import {
  SurfaceEditorToolbarButtonGroup,
  SurfaceEditorToolbarSegButton
} from "./SurfaceEditorToolbarButtonGroup";
import {
  SurfaceToolbarPopoverPanel,
  SurfaceToolbarPopoverRow,
  useSurfaceToolbarPopover
} from "./SurfaceEditorToolbarPopover";

type AlignEntry = {
  op: UiEditorAlignOp;
  icon: ComponentType<{ className?: string }>;
  labelKey: string;
  catalogId: string;
};

/** Alignment rows, in the order authors read them: the three horizontal edges, then the vertical. */
const ALIGN_ENTRIES: readonly AlignEntry[] = [
  {
    op: "left",
    icon: AlignStartVertical,
    labelKey: "uiEditor.align.left",
    catalogId: "ui-editor.align-left"
  },
  {
    op: "horizontalCenter",
    icon: AlignCenterVertical,
    labelKey: "uiEditor.align.horizontalCenter",
    catalogId: "ui-editor.align-horizontal-center"
  },
  {
    op: "right",
    icon: AlignEndVertical,
    labelKey: "uiEditor.align.right",
    catalogId: "ui-editor.align-right"
  },
  {
    op: "top",
    icon: AlignStartHorizontal,
    labelKey: "uiEditor.align.top",
    catalogId: "ui-editor.align-top"
  },
  {
    op: "verticalCenter",
    icon: AlignCenterHorizontal,
    labelKey: "uiEditor.align.verticalCenter",
    catalogId: "ui-editor.align-vertical-center"
  },
  {
    op: "bottom",
    icon: AlignEndHorizontal,
    labelKey: "uiEditor.align.bottom",
    catalogId: "ui-editor.align-bottom"
  }
];

const DISTRIBUTE_ENTRIES: readonly AlignEntry[] = [
  {
    op: "distributeHorizontal",
    icon: AlignHorizontalDistributeCenter,
    labelKey: "uiEditor.align.distributeHorizontal",
    catalogId: "ui-editor.distribute-horizontal"
  },
  {
    op: "distributeVertical",
    icon: AlignVerticalDistributeCenter,
    labelKey: "uiEditor.align.distributeVertical",
    catalogId: "ui-editor.distribute-vertical"
  }
];

const NOTHING_AVAILABLE: UiEditorAlignAvailability = {
  left: false,
  horizontalCenter: false,
  right: false,
  top: false,
  verticalCenter: false,
  bottom: false,
  distributeHorizontal: false,
  distributeVertical: false
};

type Props = {
  surfaceId: string;
  documentService: UIDocumentService | null;
  stateService: UIEditorStateService | null;
  /** Frozen workspace: the rows stay visible so the author can see what exists, but cannot fire. */
  readOnly: boolean;
  readOnlyReason?: string;
  /** Changes whenever the selection or document does, so availability re-reads. */
  revision: string;
};

/**
 * Toolbar dropdown for the eight alignment and distribution commands.
 *
 * A dropdown rather than eight toolbar cells: the strip is five cells wide, the commands only apply
 * to a multi-selection, and eight permanently-greyed icons is what the toolbar would be most of the
 * time. The rows carry their shortcuts so the repeat case moves to the keyboard.
 */
export function SurfaceAlignTrigger({
  surfaceId,
  documentService,
  stateService,
  readOnly,
  readOnlyReason,
  revision
}: Props) {
  const { t } = useTranslation();
  const popover = useSurfaceToolbarPopover(revision);
  const isMac = isMacPlatform();

  const selection = useMemo<UIElementSelection | null>(() => {
    if (!stateService) {
      return null;
    }
    const current = stateService.getSelection();
    return isUIElementSelection(current) ? (current.data as UIElementSelection) : null;
    // `revision` is the change signal; the selection object itself is replaced on every write.
  }, [stateService, revision]);

  // Availability computes every op's full patch set, so it is only worth doing while the panel is
  // open - not on every canvas render.
  const availability = useMemo(() => {
    if (!popover.open || !documentService) {
      return NOTHING_AVAILABLE;
    }
    return getUiEditorAlignAvailability(documentService.getDocument(), surfaceId, selection);
  }, [popover.open, documentService, surfaceId, selection]);

  const run = useCallback(
    (op: UiEditorAlignOp) => {
      popover.close();
      if (readOnly || !documentService) {
        return;
      }
      uiEditorAlign(documentService, surfaceId, selection, op);
    },
    [documentService, popover, readOnly, selection, surfaceId]
  );

  const renderRow = (entry: AlignEntry) => {
    const Icon = entry.icon;
    const chord = getKeybindingCatalogEntry(entry.catalogId)?.key;
    return (
      <SurfaceToolbarPopoverRow
        key={entry.op}
        icon={<Icon className="h-3.5 w-3.5" />}
        label={t(entry.labelKey as TranslationKey)}
        shortcut={chord ? formatKeybinding(chord, isMac) : undefined}
        disabled={readOnly || !availability[entry.op]}
        onClick={() => run(entry.op)}
      />
    );
  };

  return (
    <>
      <SurfaceEditorToolbarButtonGroup aria-label={t("uiEditor.align.label")}>
        <SurfaceEditorToolbarSegButton
          ref={popover.triggerRef}
          type="button"
          active={popover.open}
          onClick={popover.toggle}
          data-tip={readOnly && readOnlyReason ? readOnlyReason : t("uiEditor.align.label")}
          aria-expanded={popover.open}
          aria-haspopup="dialog"
        >
          <AlignStartVertical className="h-4 w-4" />
        </SurfaceEditorToolbarSegButton>
      </SurfaceEditorToolbarButtonGroup>
      <SurfaceToolbarPopoverPanel popover={popover} dataAttribute="align">
        <div>{ALIGN_ENTRIES.map(renderRow)}</div>
        <div className="mt-1 border-t border-edge pt-1">{DISTRIBUTE_ENTRIES.map(renderRow)}</div>
      </SurfaceToolbarPopoverPanel>
    </>
  );
}
