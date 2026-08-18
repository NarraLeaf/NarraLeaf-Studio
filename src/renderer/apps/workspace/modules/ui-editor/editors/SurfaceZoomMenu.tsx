import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n/catalog/types";
import { Input } from "@/lib/components/elements/Input";
import {
  CANVAS_FIT_MODES,
  formatZoomPercent,
  parseZoomPercent,
  type CanvasFitMode,
  type SurfaceViewportFit
} from "@/lib/ui-editor/geometry";
import {
  SurfaceEditorToolbarButtonGroup,
  SurfaceEditorToolbarSegButton,
  SurfaceEditorToolbarSegSlot
} from "./SurfaceEditorToolbarButtonGroup";
import {
  SurfaceToolbarPopoverPanel,
  SurfaceToolbarPopoverRow,
  SurfaceToolbarPopoverSection,
  useSurfaceToolbarPopover
} from "./SurfaceEditorToolbarPopover";

/** Row labels. The mode list, and the order they appear in, lives with the geometry behind them. */
const FIT_MODE_LABEL_KEYS = {
  actual: "uiEditor.zoom.actualSize",
  contain: "uiEditor.zoom.fitArea",
  cover: "uiEditor.zoom.fillArea",
  width: "uiEditor.zoom.fitWidth"
} as const satisfies Record<CanvasFitMode, TranslationKey>;

type Props = {
  /** Current scale, so the trigger reads the same number the canvas is drawn at. */
  scale: number;
  /** The mode in force, or `null` once the author moved the view by hand. */
  fit: SurfaceViewportFit | null;
  applyFitMode: (mode: CanvasFitMode) => void;
  setZoomScale: (scale: number) => void;
  /** False while the tab has no interface to measure; the whole control is then inert. */
  enabled: boolean;
};

/**
 * The zoom the canvas is at, and every way to change it deliberately.
 *
 * Split control: the percentage itself is the one-click way back to seeing all of the interface,
 * which is what an author wants from it nine times out of ten; the chevron opens the modes and the
 * box for typing an exact number.
 *
 * A mode stays live - the canvas keeps answering it while the editing area is resized - so the
 * checked row states what the view is currently following, and nothing is checked once a wheel
 * gesture, a pan or a typed number has made the view a fixed place instead.
 */
export function SurfaceZoomMenu({ scale, fit, applyFitMode, setZoomScale, enabled }: Props) {
  const { t } = useTranslation();
  const percent = formatZoomPercent(scale);
  const popover = useSurfaceToolbarPopover(`${fit?.mode ?? ""}|${percent}`);
  const [draft, setDraft] = useState(String(percent));

  // The box shows where the canvas actually is whenever the menu is opened, and follows the
  // canvas while it is open - a mode row clicked above it must not leave a stale number below.
  useEffect(() => {
    if (popover.open) {
      setDraft(String(percent));
    }
  }, [percent, popover.open]);

  const chooseMode = useCallback(
    (mode: CanvasFitMode) => {
      applyFitMode(mode);
      popover.close();
    },
    [applyFitMode, popover]
  );

  /**
   * `close` only on Enter. Blur must not close the menu, and must not apply anything either when
   * the box still reads where the canvas already is: clicking a mode row blurs the box first, and
   * a commit there would install a fixed zoom and dismiss the panel before the row was ever hit.
   */
  const commitDraft = useCallback(
    (close: boolean) => {
      const parsed = parseZoomPercent(draft);
      if (parsed === null || formatZoomPercent(parsed) === percent) {
        // Not a number, or the number it already shows. Putting the current zoom back beats
        // jumping to a guess at what was meant.
        setDraft(String(percent));
        if (close) {
          popover.close();
        }
        return;
      }
      setZoomScale(parsed);
      if (close) {
        popover.close();
      }
    },
    [draft, percent, popover, setZoomScale]
  );

  return (
    <>
      <SurfaceEditorToolbarButtonGroup aria-label={t("uiEditor.zoom.label")}>
        <SurfaceEditorToolbarSegButton
          type="button"
          disabled={!enabled}
          onClick={() => applyFitMode("contain")}
          className="w-auto min-w-14 px-2 tabular-nums"
          data-tip={t("uiEditor.zoom.fitArea")}
          aria-label={t("uiEditor.zoom.fitArea")}
        >
          {percent}%
        </SurfaceEditorToolbarSegButton>
        <SurfaceEditorToolbarSegSlot>
          <SurfaceEditorToolbarSegButton
            ref={popover.triggerRef}
            type="button"
            disabled={!enabled}
            active={popover.open}
            onClick={popover.toggle}
            data-tip={t("uiEditor.zoom.label")}
            aria-label={t("uiEditor.zoom.label")}
            aria-expanded={popover.open}
            aria-haspopup="dialog"
          >
            <ChevronDown className="h-4 w-4" />
          </SurfaceEditorToolbarSegButton>
        </SurfaceEditorToolbarSegSlot>
      </SurfaceEditorToolbarButtonGroup>
      <SurfaceToolbarPopoverPanel popover={popover} dataAttribute="zoom">
        {/* Unheaded: the panel is the zoom control, so a "Zoom" heading above its own
                    options would be the only thing in it saying nothing. */}
        {CANVAS_FIT_MODES.map((mode) => (
          <SurfaceToolbarPopoverRow
            key={mode}
            label={t(FIT_MODE_LABEL_KEYS[mode])}
            shortcut={mode === "actual" ? "100%" : undefined}
            selected={fit?.mode === mode}
            onClick={() => chooseMode(mode)}
          />
        ))}
        <SurfaceToolbarPopoverSection label={t("uiEditor.zoom.custom")}>
          <div className="flex items-center gap-1.5 px-3 pb-1 pt-0.5">
            <div className="min-w-0 flex-1">
              <Input
                size="sm"
                fullWidth
                inputMode="decimal"
                className="tabular-nums"
                aria-label={t("uiEditor.zoom.custom")}
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
    </>
  );
}
