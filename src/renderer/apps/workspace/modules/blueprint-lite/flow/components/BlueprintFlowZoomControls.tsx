/**
 * Zoom control for the graph canvas, styled like the rest of the workspace (replaces
 * @xyflow/react's own `Controls`).
 *
 * The same vocabulary the surface editor's zoom offers - actual size, fit, fill, fit width, and a
 * box for an exact percentage - so an author who learned it on one canvas has not learned it for
 * one canvas. What differs is that here they are one-shot actions rather than standing modes: a
 * graph's bounding box changes on every node drag, so a mode that stayed live would re-frame the
 * canvas mid-gesture. Nothing is ever checked in the menu for the same reason.
 *
 * Comments in English per project convention.
 */

import { useCallback, useEffect, useState } from "react";
import { useReactFlow, useStore, useStoreApi } from "@xyflow/react";
import { ChevronDown, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/lib/components/elements/Button";
import { Input } from "@/lib/components/elements/Input";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n/catalog/types";
import {
  CANVAS_FIT_MODES,
  formatZoomPercent,
  parseZoomPercent,
  type CanvasFitMode
} from "@/lib/ui-editor/geometry";
import {
  SurfaceToolbarPopoverPanel,
  SurfaceToolbarPopoverRow,
  SurfaceToolbarPopoverSection,
  useSurfaceToolbarPopover
} from "@/apps/workspace/modules/ui-editor/editors/SurfaceEditorToolbarPopover";
import {
  boundsOfMeasuredNodes,
  clampBlueprintZoom,
  computeBlueprintZoomViewport
} from "../blueprintZoom";

const FIT_MODE_LABEL_KEYS = {
  actual: "blueprint.zoom.actualSize",
  contain: "blueprint.zoom.fitArea",
  cover: "blueprint.zoom.fillArea",
  width: "blueprint.zoom.fitWidth"
} as const satisfies Record<CanvasFitMode, TranslationKey>;

const STEP_BUTTON_CLASS = "!min-h-0 !px-1.5 !py-1.5";

/**
 * The canvas's bottom-left corner is underneath the member panel, which is an `absolute` `w-56`
 * overlay rather than a column beside it. Parked at `left-3` the control is drawn and painted over,
 * so it clears the panel while that is open and takes the corner back when it is not.
 */
const PANEL_CLEARANCE_CLASS = { open: "left-60", collapsed: "left-3" } as const;

export function BlueprintFlowZoomControls({
  memberPanelCollapsed = false
}: {
  memberPanelCollapsed?: boolean;
}) {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, zoomTo, setViewport } = useReactFlow();
  // Read at click time rather than subscribed: what a mode needs - the pane, the zoom limits and
  // every node's measured size - is a snapshot of the store, and subscribing to it would re-render
  // this control on every pointer move over the canvas.
  const store = useStoreApi();

  // The one thing it does subscribe to, because the readout has to follow the canvas live.
  const zoom = useStore((state) => state.transform[2]);

  const percent = formatZoomPercent(zoom);
  const popover = useSurfaceToolbarPopover(percent);
  const [draft, setDraft] = useState(String(percent));

  // The box shows where the canvas actually is whenever the menu is opened, and follows it while
  // open - a mode clicked above it must not leave a stale number below.
  useEffect(() => {
    if (popover.open) {
      setDraft(String(percent));
    }
  }, [percent, popover.open]);

  const applyMode = useCallback(
    (mode: CanvasFitMode) => {
      const { nodeLookup, width, height, minZoom, maxZoom } = store.getState();
      const bounds = boundsOfMeasuredNodes(
        [...nodeLookup.values()].map((node) => ({
          x: node.internals.positionAbsolute.x,
          y: node.internals.positionAbsolute.y,
          width: node.measured.width ?? 0,
          height: node.measured.height ?? 0
        }))
      );
      const next = computeBlueprintZoomViewport({
        mode,
        bounds,
        container: { width, height },
        range: { min: minZoom, max: maxZoom }
      });
      if (next) {
        setViewport(next, { duration: 220 });
      }
      popover.close();
    },
    [popover, setViewport, store]
  );

  /**
   * `close` only on Enter. Blur must not close the menu, and must not apply anything either when
   * the box still reads where the canvas already is: clicking a mode row blurs the box first, and
   * a commit there would move the canvas and dismiss the panel before the row was ever hit.
   */
  const commitDraft = useCallback(
    (close: boolean) => {
      const { minZoom, maxZoom } = store.getState();
      const range = { min: minZoom, max: maxZoom };
      const parsed = parseZoomPercent(draft, range);
      if (parsed === null || formatZoomPercent(parsed) === percent) {
        setDraft(String(percent));
      } else {
        // Zooms about the middle of the pane, which is what the author is looking at.
        zoomTo(clampBlueprintZoom(parsed, range), { duration: 180 });
      }
      if (close) {
        popover.close();
      }
    },
    [draft, percent, popover, store, zoomTo]
  );

  return (
    <div
      className={`absolute bottom-3 ${memberPanelCollapsed ? PANEL_CLEARANCE_CLASS.collapsed : PANEL_CLEARANCE_CLASS.open} z-[5] flex items-center gap-0.5 rounded-lg border border-edge bg-surface-overlay p-0.5 shadow-lg transition-[left] duration-200 ease-out`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={STEP_BUTTON_CLASS}
        aria-label={t("blueprint.zoom.out")}
        data-tip={t("blueprint.zoom.out")}
        onClick={() => zoomOut({ duration: 180 })}
      >
        <ZoomOut className="h-3.5 w-3.5 text-fg-muted" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={STEP_BUTTON_CLASS}
        aria-label={t("blueprint.zoom.in")}
        data-tip={t("blueprint.zoom.in")}
        onClick={() => zoomIn({ duration: 180 })}
      >
        <ZoomIn className="h-3.5 w-3.5 text-fg-muted" />
      </Button>
      <div className="mx-0.5 h-5 w-px bg-edge" />
      {/* The percentage is the one-click way back to seeing the whole graph, which is what an
                author wants from it nine times out of ten; the chevron opens the rest. */}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={`${STEP_BUTTON_CLASS} min-w-11 tabular-nums text-fg-muted`}
        aria-label={t("blueprint.zoom.fitArea")}
        data-tip={t("blueprint.zoom.fitArea")}
        onClick={() => applyMode("contain")}
      >
        {percent}%
      </Button>
      <Button
        ref={popover.triggerRef}
        type="button"
        size="sm"
        variant="ghost"
        className={STEP_BUTTON_CLASS}
        aria-label={t("blueprint.zoom.label")}
        data-tip={t("blueprint.zoom.label")}
        aria-expanded={popover.open}
        aria-haspopup="dialog"
        onClick={popover.toggle}
      >
        <ChevronDown className="h-3.5 w-3.5 text-fg-muted" />
      </Button>
      <SurfaceToolbarPopoverPanel popover={popover} dataAttribute="blueprint-zoom">
        {CANVAS_FIT_MODES.map((mode) => (
          <SurfaceToolbarPopoverRow
            key={mode}
            label={t(FIT_MODE_LABEL_KEYS[mode])}
            shortcut={mode === "actual" ? "100%" : undefined}
            onClick={() => applyMode(mode)}
          />
        ))}
        <SurfaceToolbarPopoverSection label={t("blueprint.zoom.custom")}>
          <div className="flex items-center gap-1.5 px-3 pb-1 pt-0.5">
            <div className="min-w-0 flex-1">
              <Input
                size="sm"
                fullWidth
                inputMode="decimal"
                className="tabular-nums"
                aria-label={t("blueprint.zoom.custom")}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitDraft(true);
                  }
                }}
                onBlur={() => commitDraft(false)}
              />
            </div>
            <span className="shrink-0 text-xs text-fg-subtle">%</span>
          </div>
        </SurfaceToolbarPopoverSection>
      </SurfaceToolbarPopoverPanel>
    </div>
  );
}
