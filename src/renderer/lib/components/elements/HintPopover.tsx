import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "../../utils/cn";

/** Gap between the trigger icon and the popover. */
const HINT_GAP_PX = 4;
/** Keep the popover this far away from the viewport edges. */
const HINT_MARGIN_PX = 8;
const HINT_DEFAULT_WIDTH_PX = 224;

export interface HintPopoverProps {
    /** Explanation shown on hover/focus; also the trigger's accessible name. */
    text: string;
    /** Trigger glyph — defaults to an info circle. */
    icon?: React.ReactNode;
    /** Popover width in pixels. */
    width?: number;
    className?: string;
}

/**
 * A compact "?" affordance that reveals its explanation in a hover/focus popover.
 *
 * Unlike {@link Tooltip}, the panel is portalled to `document.body` and positioned
 * with `fixed` coordinates, so it survives the `overflow-hidden`/`overflow-auto`
 * ancestors and fixed-width sidebars that would otherwise clip it.
 */
export function HintPopover({ text, icon, width = HINT_DEFAULT_WIDTH_PX, className }: HintPopoverProps) {
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLSpanElement | null>(null);
    const [open, setOpen] = useState(false);
    const [style, setStyle] = useState<React.CSSProperties | null>(null);

    useLayoutEffect(() => {
        if (!open) {
            setStyle(null);
            return;
        }

        const position = () => {
            const trigger = triggerRef.current?.getBoundingClientRect();
            if (!trigger) {
                return;
            }

            const panelHeight = panelRef.current?.getBoundingClientRect().height ?? 0;
            const spaceBelow = window.innerHeight - trigger.bottom - HINT_GAP_PX;
            const openAbove = panelHeight > spaceBelow && trigger.top - HINT_GAP_PX > spaceBelow;

            const top = openAbove
                ? Math.max(HINT_MARGIN_PX, trigger.top - HINT_GAP_PX - panelHeight)
                : Math.min(
                      trigger.bottom + HINT_GAP_PX,
                      Math.max(HINT_MARGIN_PX, window.innerHeight - HINT_MARGIN_PX - panelHeight),
                  );
            const left = Math.max(
                HINT_MARGIN_PX,
                Math.min(trigger.left, window.innerWidth - HINT_MARGIN_PX - width),
            );

            setStyle({ position: "fixed", top, left, width });
        };

        position();
        // The first pass runs before the panel has a measurable height; re-run once it does.
        const raf = requestAnimationFrame(position);
        window.addEventListener("resize", position);
        window.addEventListener("scroll", position, true);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", position);
            window.removeEventListener("scroll", position, true);
        };
    }, [open, width]);

    const show = useCallback(() => setOpen(true), []);
    const hide = useCallback(() => setOpen(false), []);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                aria-label={text}
                className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-fg-subtle outline-none transition-colors hover:text-fg-muted focus-visible:text-fg-muted",
                    className,
                )}
                onMouseEnter={show}
                onMouseLeave={hide}
                onFocus={show}
                onBlur={hide}
            >
                {icon ?? <Info className="h-3.5 w-3.5" />}
            </button>
            {open
                ? createPortal(
                      <span
                          ref={panelRef}
                          role="tooltip"
                          style={style ?? { position: "fixed", top: 0, left: 0, width, visibility: "hidden" }}
                          className="pointer-events-none z-[110] block rounded-md border border-edge bg-surface-raised px-2 py-1.5 text-2xs font-normal leading-snug text-fg-muted shadow-xl"
                      >
                          {text}
                      </span>,
                      document.body,
                  )
                : null}
        </>
    );
}
