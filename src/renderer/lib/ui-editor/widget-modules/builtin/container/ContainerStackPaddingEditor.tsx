import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import {
    clampContainerStackSpacingPx,
    CONTAINER_STACK_SPACING_ABS_MAX_PX,
    type ContainerWidgetProps,
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
    onPatch,
}: ContainerStackPaddingEditorProps) {
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
                stackPaddingLeft: next,
            });
        },
        [patchPadding]
    );

    const handleSideNumber = useCallback(
        (key: "stackPaddingTop" | "stackPaddingRight" | "stackPaddingBottom" | "stackPaddingLeft", v: number) => {
            const next = clampContainerStackSpacingPx(v);
            patchPadding({ [key]: next });
        },
        [patchPadding]
    );

    const closeSides = useCallback(() => setSidesOpen(false), []);

    const toggleSides = useCallback(() => {
        setSidesOpen(o => !o);
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
        { key: "stackPaddingTop" as const, label: "Top" },
        { key: "stackPaddingRight" as const, label: "Right" },
        { key: "stackPaddingBottom" as const, label: "Bottom" },
        { key: "stackPaddingLeft" as const, label: "Left" },
    ];

    const popover =
        sidesOpen && typeof document !== "undefined"
            ? createPortal(
                  <div
                      ref={panelRef}
                      role="dialog"
                      aria-label="Padding per side"
                      className="fixed z-[70] rounded-xl border border-edge bg-[#17181c] p-3 shadow-2xl"
                      style={{
                          left: popoverPos.left,
                          top: popoverPos.top,
                          width: popoverPos.width,
                          maxWidth: "calc(100vw - 16px)",
                      }}
                      onMouseDown={e => e.stopPropagation()}
                  >
                      <p className="mb-2 text-xs font-medium text-fg-muted">Per side (px)</p>
                      <div className="grid grid-cols-2 gap-2 min-w-0">
                          {sideKeys.map(({ key, label }) => (
                              <div key={key} className="flex min-w-0 flex-col gap-1">
                                  <span className="text-2xs font-medium text-fg-subtle">{label}</span>
                                  <NumericDraftEnhancedInput
                                      committedDisplay={String(current[key])}
                                      draftResetKey={`${draftResetKey}-pad-${key}`}
                                      onFiniteNumber={n => handleSideNumber(key, n)}
                                      inputMode="numeric"
                                      type="number"
                                      min={-CONTAINER_STACK_SPACING_ABS_MAX_PX}
                                      max={CONTAINER_STACK_SPACING_ABS_MAX_PX}
                                      unit="px"
                                      aria-label={`Padding ${label}`}
                                      title={`Padding ${label}`}
                                      className="w-full min-w-0"
                                      selectAllOnFocus
                                  />
                              </div>
                          ))}
                      </div>
                  </div>,
                  document.body
              )
            : null;

    return (
        <>
            <div ref={anchorRef} className="flex min-w-0 w-full flex-col gap-1 self-start">
                <span className="text-xs font-medium text-fg-muted">Padding</span>
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
                            aria-label="Padding on all sides"
                            title="Padding (all sides)"
                            className="w-full min-w-0"
                            selectAllOnFocus
                        />
                    </div>
                    <button
                        type="button"
                        onClick={toggleSides}
                        aria-expanded={sidesOpen}
                        aria-haspopup="dialog"
                        aria-label={sidesOpen ? "Close per-side padding" : "Edit per-side padding"}
                        className={controlButtonClass(sidesOpen)}
                        title="Per-side padding"
                    >
                        {sidesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                </div>
            </div>
            {popover}
        </>
    );
}
