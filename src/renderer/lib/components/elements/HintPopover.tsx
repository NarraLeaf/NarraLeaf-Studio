import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "../../utils/cn";

/** Gap between the trigger icon and the popover. */
const HINT_GAP_PX = 4;
/** Keep the popover this far away from the viewport edges. */
const HINT_MARGIN_PX = 8;
const HINT_DEFAULT_WIDTH_PX = 224;

/** The box a panel points at, in viewport coordinates. Only the three edges placement reads. */
export type PanelAnchor = { top: number; bottom: number; left: number };

export interface AnchoredPanelProps {
  /**
   * Where the panel points, in viewport coordinates.
   *
   * A function rather than a value because it is re-read on every reposition: the thing being
   * pointed at is usually an element, and an element moves when the page scrolls or reflows.
   * Returning `null` leaves the panel where it was.
   */
  anchor: () => PanelAnchor | null;
  /** Panel width in pixels. Placement needs it before the panel has been laid out. */
  width: number;
  /** Everything about how the panel looks; this component only decides where it is. */
  className?: string;
  role?: string;
  /** The panel element, for callers that have to answer "was that click inside?". */
  panelRef?: React.MutableRefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}

/**
 * A panel portalled to `document.body` and placed against an anchor with `fixed` coordinates.
 *
 * The portal is the point. A panel rendered in place is clipped by the first `overflow-hidden`
 * ancestor it meets, and in this app that is nearly always the panel it was opened from — a sidebar,
 * an editor pane, a scrolled row list. Placed here it is clipped by nothing, and the placement takes
 * the viewport's own edges into account instead: below the anchor when there is room, flipped above
 * when there is not, and never past the margin on either side.
 *
 * The anchor is re-read on scroll and resize, so a panel opened over a scrolling list follows what
 * it points at rather than hanging in the air where it started.
 */
export function AnchoredPanel({
  anchor,
  width,
  className,
  role,
  panelRef,
  children
}: AnchoredPanelProps) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties | null>(null);
  // Held in a ref so a caller's inline arrow does not re-run placement on every render.
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  useLayoutEffect(() => {
    const position = () => {
      const box = anchorRef.current();
      if (!box) {
        return;
      }

      const panelHeight =
        (panelRef?.current ?? ownRef.current)?.getBoundingClientRect().height ?? 0;
      const spaceBelow = window.innerHeight - box.bottom - HINT_GAP_PX;
      const openAbove = panelHeight > spaceBelow && box.top - HINT_GAP_PX > spaceBelow;

      const top = openAbove
        ? Math.max(HINT_MARGIN_PX, box.top - HINT_GAP_PX - panelHeight)
        : Math.min(
            box.bottom + HINT_GAP_PX,
            Math.max(HINT_MARGIN_PX, window.innerHeight - HINT_MARGIN_PX - panelHeight)
          );
      const left = Math.max(
        HINT_MARGIN_PX,
        Math.min(box.left, window.innerWidth - HINT_MARGIN_PX - width)
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
  }, [panelRef, width]);

  return createPortal(
    <div
      ref={(element) => {
        ownRef.current = element;
        if (panelRef) {
          panelRef.current = element;
        }
      }}
      role={role}
      style={style ?? { position: "fixed", top: 0, left: 0, width, visibility: "hidden" }}
      className={className}
    >
      {children}
    </div>,
    document.body
  );
}

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
 * ancestors and fixed-width sidebars that would otherwise clip it. That placement is
 * {@link AnchoredPanel}, which other floating panels share rather than re-deriving.
 */
export function HintPopover({
  text,
  icon,
  width = HINT_DEFAULT_WIDTH_PX,
  className
}: HintPopoverProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const anchor = useCallback(() => triggerRef.current?.getBoundingClientRect() ?? null, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={text}
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-fg-subtle outline-none transition-colors hover:text-fg-muted focus-visible:text-fg-muted",
          className
        )}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {icon ?? <Info className="h-3.5 w-3.5" />}
      </button>
      {open ? (
        <AnchoredPanel
          anchor={anchor}
          width={width}
          role="tooltip"
          className="pointer-events-none z-[110] block rounded-md border border-edge bg-surface-raised px-2 py-1.5 text-2xs font-normal leading-snug text-fg-muted shadow-xl"
        >
          {text}
        </AnchoredPanel>
      ) : null}
    </>
  );
}
