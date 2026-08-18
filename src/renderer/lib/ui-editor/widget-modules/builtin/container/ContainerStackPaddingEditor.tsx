import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { InspectOnlyButton } from "@/lib/components/elements/InspectOnlyButton";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { useTranslation } from "@/lib/i18n";
import {
  clampContainerStackSpacingPx,
  CONTAINER_STACK_SPACING_ABS_MAX_PX,
  type ContainerWidgetProps
} from "@shared/types/ui-editor/container";

export type ContainerStackPaddingEditorProps = {
  current: ContainerWidgetProps;
  draftResetKey: string;
  onSaving: (saving: boolean) => void;
  onPatch: (partial: Partial<ContainerWidgetProps>) => void;
};

function areStackPaddingsUniform(p: ContainerWidgetProps): boolean {
  const { stackPaddingTop, stackPaddingRight, stackPaddingBottom, stackPaddingLeft } = p;
  return (
    stackPaddingTop === stackPaddingRight &&
    stackPaddingTop === stackPaddingBottom &&
    stackPaddingTop === stackPaddingLeft
  );
}

/**
 * Stack/scroll inner padding: one inline "all sides" field plus a popover for per-edge values.
 * Popover keeps the inspector inline row height stable (avoids flex `items-stretch` / `items-center` issues).
 */
export function ContainerStackPaddingEditor({
  current,
  draftResetKey,
  onSaving,
  onPatch
}: ContainerStackPaddingEditorProps) {
  const { t } = useTranslation();
  /**
   * Read here rather than taken as a prop: this editor is mounted from an `inlineRow` render
   * callback, whose context carries no `readOnly` for the caller to pass on.
   */
  const freeze = useFreezeGuard();
  const [sidesOpen, setSidesOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ left: 0, top: 0, width: 280 });
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSidesOpen(false);
  }, [draftResetKey]);

  const withSaving = useCallback(
    (fn: () => void) => {
      onSaving(true);
      try {
        fn();
      } finally {
        onSaving(false);
      }
    },
    [onSaving]
  );

  const patchPadding = useCallback(
    (partial: Partial<ContainerWidgetProps>) => {
      withSaving(() => {
        onPatch(partial);
      });
    },
    [onPatch, withSaving]
  );

  const uniform = areStackPaddingsUniform(current);
  const uniformDisplay = uniform ? String(current.stackPaddingTop) : "";
  const uniformPlaceholder = uniform ? undefined : "-";

  const handleUniformNumber = useCallback(
    (v: number) => {
      const next = clampContainerStackSpacingPx(v);
      patchPadding({
        stackPaddingTop: next,
        stackPaddingRight: next,
        stackPaddingBottom: next,
        stackPaddingLeft: next
      });
    },
    [patchPadding]
  );

  const handleSideNumber = useCallback(
    (
      key: "stackPaddingTop" | "stackPaddingRight" | "stackPaddingBottom" | "stackPaddingLeft",
      v: number
    ) => {
      const next = clampContainerStackSpacingPx(v);
      patchPadding({ [key]: next });
    },
    [patchPadding]
  );

  const closeSides = useCallback(() => setSidesOpen(false), []);

  const toggleSides = useCallback(() => {
    setSidesOpen((o) => !o);
  }, []);

  useLayoutEffect(() => {
    if (!sidesOpen || !anchorRef.current) {
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const panelHeight = panelRef.current?.getBoundingClientRect().height ?? 140;
      const viewportPadding = 8;
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - viewportPadding * 2);
      let left = rect.left;
      let top = rect.bottom + 6;

      if (left + width > window.innerWidth - viewportPadding) {
        left = window.innerWidth - width - viewportPadding;
      }
      if (left < viewportPadding) {
        left = viewportPadding;
      }
      if (top + panelHeight > window.innerHeight - viewportPadding) {
        top = rect.top - panelHeight - 6;
      }
      if (top < viewportPadding) {
        top = viewportPadding;
      }

      setPopoverPos({ left, top, width });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [sidesOpen]);

  useEffect(() => {
    if (!sidesOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      closeSides();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSides();
      }
    };

    const t = window.setTimeout(() => {
      document.addEventListener("mousedown", handlePointerDown, true);
    }, 0);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeSides, sidesOpen]);

  const sideKeys = [
    { key: "stackPaddingTop" as const, label: t("widgets.sides.top") },
    { key: "stackPaddingRight" as const, label: t("widgets.sides.right") },
    { key: "stackPaddingBottom" as const, label: t("widgets.sides.bottom") },
    { key: "stackPaddingLeft" as const, label: t("widgets.sides.left") }
  ];

  const popover =
    sidesOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={t("widgets.container.paddingDialog")}
            className="fixed z-[70] rounded-xl border border-edge bg-surface-raised p-3 shadow-2xl"
            style={{
              left: popoverPos.left,
              top: popoverPos.top,
              width: popoverPos.width,
              maxWidth: "calc(100vw - 16px)"
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-xs font-medium text-fg-muted">{t("widgets.perSidePx")}</p>
            {/* The popover's own clamp, because it is a portal into `document.body` and so
                          escapes the `<fieldset disabled>` the inspector wraps this field in. The
                          four boxes all write, and there is nothing in here to exempt. */}
            <fieldset
              disabled={freeze.frozen}
              aria-readonly={freeze.frozen || undefined}
              data-tip={freeze.frozen ? freeze.reason : undefined}
              style={{ display: "contents" }}
            >
              <div className="grid grid-cols-2 gap-2 min-w-0">
                {sideKeys.map(({ key, label }) => (
                  <div key={key} className="flex min-w-0 flex-col gap-1">
                    <span className="text-2xs font-medium text-fg-subtle">{label}</span>
                    <NumericDraftEnhancedInput
                      committedDisplay={String(current[key])}
                      draftResetKey={`${draftResetKey}-pad-${key}`}
                      onFiniteNumber={(n) => handleSideNumber(key, n)}
                      inputMode="numeric"
                      type="number"
                      min={-CONTAINER_STACK_SPACING_ABS_MAX_PX}
                      max={CONTAINER_STACK_SPACING_ABS_MAX_PX}
                      unit="px"
                      aria-label={t("widgets.container.paddingSide", { side: label })}
                      data-tip={t("widgets.container.paddingSide", { side: label })}
                      className="w-full min-w-0"
                      selectAllOnFocus
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div ref={anchorRef} className="flex min-w-0 w-full flex-col gap-1 self-start">
        <span className="text-xs font-medium text-fg-muted">{t("widgets.container.padding")}</span>
        <div className="flex min-w-0 flex-nowrap items-stretch gap-2">
          <div className="min-w-0 flex-1">
            <NumericDraftEnhancedInput
              committedDisplay={uniformDisplay}
              draftResetKey={`${draftResetKey}-pad-u`}
              onFiniteNumber={handleUniformNumber}
              inputMode="numeric"
              type="number"
              min={-CONTAINER_STACK_SPACING_ABS_MAX_PX}
              max={CONTAINER_STACK_SPACING_ABS_MAX_PX}
              unit="px"
              placeholder={uniformPlaceholder}
              aria-label={t("widgets.container.paddingAllSides")}
              data-tip={t("widgets.container.paddingAllTitle")}
              className="w-full min-w-0"
              selectAllOnFocus
            />
          </div>
          {/* Opening the popover only shows what the four edges are set to - the writing
                        happens in the boxes inside it, which have their own clamp above. As a
                        `<button>` the inspector's `<fieldset disabled>` caught this chevron, so on a
                        frozen project a container with uneven padding showed "-" in the all-sides
                        box and there was no way to find out the four numbers behind it. */}
          <InspectOnlyButton
            onClick={toggleSides}
            aria-expanded={sidesOpen}
            aria-label={
              sidesOpen
                ? t("widgets.container.perSidePaddingClose")
                : t("widgets.container.perSidePaddingEdit")
            }
            className={`${controlButtonClass(sidesOpen)} cursor-default`}
            data-tip={t("widgets.container.perSidePadding")}
          >
            {sidesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </InspectOnlyButton>
        </div>
      </div>
      {popover}
    </>
  );
}
