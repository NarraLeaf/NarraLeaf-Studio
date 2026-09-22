import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";
import { UI_TOUCH_GESTURE_EVENT } from "@/lib/ui-editor/runtime/input/touchGesture";

const BOX_STYLE: CSSProperties = { position: "absolute", inset: 0 };

function stopHere(event: SyntheticEvent): void {
    event.stopPropagation();
}

function stopContextMenuHere(event: SyntheticEvent): void {
    // Nothing further up answers it, so nothing further up gets to prevent the browser's own menu.
    event.preventDefault();
    event.stopPropagation();
}

const SWALLOW_PRESSES = {
    onClick: stopHere,
    onDoubleClick: stopHere,
    onAuxClick: stopHere,
    onContextMenu: stopContextMenuHere,
    onWheel: stopHere,
    onPointerDown: stopHere,
    onPointerUp: stopHere,
};

function stopNativeHere(event: Event): void {
    event.stopPropagation();
}

/**
 * The box a frame draws its pages in: the frame's whole area, under every page it shows.
 *
 * While the frame is changing page - a page on its way out, or one still drawn after the frame has
 * moved on to another - a press that reaches this box goes no further. A press on an element of the
 * page the frame is going to has already been answered by that element on its way here; anything
 * else that reaches the box landed on a page that no longer takes input, or on the frame around it,
 * and handing it on would make it a press on the frame. That is not what the player aimed at, and
 * it is not harmless: the frame's click walks up the element tree, and the surface the frame is on
 * answers it with its own actions. A frame on the dialogue box turns it into the next line - so
 * pressing a page's Close button twice, the second time as the page fades out, spent a line the
 * player never read, where the same button at rest advances nothing.
 *
 * The same rule a game app keeps for its pages over the stage (`SurfaceStackBox`), for the same
 * reason, applied to the frame's area. Once the frame has settled on its page, or on none, a press
 * on the frame is the frame's again.
 *
 * Stopping here rather than taking the frame's page out of hit testing: the page the frame is going
 * to must go on taking presses, and a page's elements answer a press before it bubbles up to here.
 * A recognised touch gesture travels under a private event name React has no prop for, so it is
 * stopped by a listener of the same kind the surface lane uses to hear it.
 */
export function FramePageBox(props: { changingPage: boolean; children: ReactNode }): ReactNode {
    const { changingPage, children } = props;
    const boxRef = useRef<HTMLDivElement | null>(null);

    // Attached in the commit that starts the change, as the press handlers below are, so no gesture
    // arrives in between.
    useLayoutEffect(() => {
        const box = boxRef.current;
        if (!box || !changingPage) {
            return undefined;
        }
        box.addEventListener(UI_TOUCH_GESTURE_EVENT, stopNativeHere);
        return () => box.removeEventListener(UI_TOUCH_GESTURE_EVENT, stopNativeHere);
    }, [changingPage]);

    return (
        <div
            ref={boxRef}
            data-ui-frame-page-box=""
            data-ui-frame-changing-page={changingPage ? "" : undefined}
            style={BOX_STYLE}
            {...(changingPage ? SWALLOW_PRESSES : {})}
        >
            {children}
        </div>
    );
}
