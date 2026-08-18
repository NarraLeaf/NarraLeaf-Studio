import React from "react";
import {
  TOOLTIP_GROUP_ATTRIBUTE,
  TOOLTIP_SIDE_ATTRIBUTE,
  type TooltipSide
} from "./tooltipController";

export interface TooltipGroupProps extends React.HTMLAttributes<HTMLElement> {
  /** The tag to draw, for a strip whose wrapper was not a `div`. */
  as?: "div" | "span" | "section" | "nav" | "ul";
  /**
   * Which way this strip's tooltips open. Omitted, they open above like everywhere else.
   *
   * A rail against an edge states the inward direction once here - `right` on the left rail,
   * `left` on the right rail - instead of every icon in it repeating the same thing.
   */
  side?: TooltipSide;
  children?: React.ReactNode;
}

/**
 * A strip whose tooltips share one delay: the first waits, the rest appear as the pointer reaches
 * them, until it leaves the strip.
 *
 * Put it where the row's own wrapper already is - `<div className="flex items-center gap-0.5">`
 * becomes `<TooltipGroup className="flex items-center gap-0.5">` - so a group adds no element and no
 * layout. Wrapping an existing wrapper is the one way to get this wrong: the extra box is exactly
 * what the attribute-based tooltip was chosen to avoid.
 *
 * Reach for it where the author reads several controls in a row, which is toolbars, panel headers
 * and inspector button strips. A lone button does not need one, and a group around a whole panel
 * makes the panel's every tooltip instant after the first, which is not the same interface.
 */
export const TooltipGroup = React.forwardRef<HTMLElement, TooltipGroupProps>(function TooltipGroup(
  { as: Tag = "div", side, children, ...props },
  ref
) {
  const attributes: Record<string, string> = { [TOOLTIP_GROUP_ATTRIBUTE]: "" };
  if (side) {
    attributes[TOOLTIP_SIDE_ATTRIBUTE] = side;
  }
  return (
    <Tag {...props} {...attributes} ref={ref as React.Ref<never>}>
      {children}
    </Tag>
  );
});
