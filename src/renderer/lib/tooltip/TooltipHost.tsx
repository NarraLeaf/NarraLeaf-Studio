import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHostDocument } from "@/lib/components/layout/hostWindow";
import { startTooltipTracking, type TooltipTarget } from "./tooltipController";

/** Distance from the anchor's edge. */
const TOOLTIP_GAP_PX = 6;
/** Keep the bubble this far from the window edges. */
const TOOLTIP_MARGIN_PX = 8;

/**
 * The one tooltip surface a window draws.
 *
 * Portalled to the document body, unlike a dialog, which belongs in the window overlay host. The
 * reason a dialog may not sit outside the window root is that its backdrop would then dim the title
 * bar and swallow clicks on the window controls; a tooltip has no backdrop and takes no pointer
 * events at all, so the objection does not apply - while the requirement does, in the other
 * direction. Context menus portal to the body and rank at `z-50` there, and the rows of a menu carry
 * tooltips of their own (the developer-mode copy-id rows), so a tooltip parked inside the window
 * root would be painted over by the very menu it describes. Hence the body, above the title bar.
 *
 * One host per window: `WorkspaceLayout`, `NavigationLayout` and `AppLayout` each mount one, and a
 * detached editor mounts its own, since `useHostDocument` is what tells this subtree which document
 * it is really drawn in.
 */
export function TooltipHost() {
    const doc = useHostDocument();
    const bubbleRef = useRef<HTMLDivElement | null>(null);
    const [target, setTarget] = useState<TooltipTarget | null>(null);
    const [style, setStyle] = useState<React.CSSProperties | null>(null);

    useEffect(() => startTooltipTracking(doc, setTarget), [doc]);

    useLayoutEffect(() => {
        if (!target) {
            setStyle(null);
            return;
        }
        const bubble = bubbleRef.current;
        const view = doc.defaultView;
        if (!bubble || !view) {
            return;
        }
        const anchor = target.anchor.getBoundingClientRect();
        const size = bubble.getBoundingClientRect();

        // Above by default, because that is the half of a control the pointer is least likely to be
        // resting on. Below only when there is no room, which is the top toolbar and the title bar.
        const above = anchor.top - TOOLTIP_GAP_PX - size.height;
        const top = above < TOOLTIP_MARGIN_PX ? anchor.bottom + TOOLTIP_GAP_PX : above;
        const left = Math.max(
            TOOLTIP_MARGIN_PX,
            Math.min(
                anchor.left + anchor.width / 2 - size.width / 2,
                view.innerWidth - TOOLTIP_MARGIN_PX - size.width,
            ),
        );
        setStyle({ position: "fixed", top: Math.round(top), left: Math.round(left) });
    }, [doc, target]);

    if (!target) {
        return null;
    }

    return createPortal(
        <div
            ref={bubbleRef}
            role="tooltip"
            // Measured before it is placed, so the first pass draws it at the origin. Hidden rather
            // than transparent for that one frame: a transparent box still has to be composited, and
            // this one is thrown away every time the pointer moves to the next control.
            style={style ?? { position: "fixed", top: 0, left: 0, visibility: "hidden" }}
            className="pointer-events-none z-[20010] max-w-[240px] whitespace-pre-line break-words rounded-md border border-edge bg-surface-overlay px-2 py-1 text-2xs leading-snug text-fg shadow-lg"
        >
            {target.text}
        </div>,
        doc.body,
    );
}
