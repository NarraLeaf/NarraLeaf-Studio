import { useRef, type CSSProperties, type ReactNode } from "react";
import { SWALLOW_PRESS_HANDLERS, useSwallowTouchGestures } from "@/lib/ui-editor/runtime/input/swallowPresses";

const BOX_STYLE: CSSProperties = { position: "absolute", inset: 0 };

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
 */
export function FramePageBox(props: { changingPage: boolean; children: ReactNode }): ReactNode {
    const { changingPage, children } = props;
    const boxRef = useRef<HTMLDivElement | null>(null);
    useSwallowTouchGestures(boxRef, changingPage);

    return (
        <div
            ref={boxRef}
            data-ui-frame-page-box=""
            data-ui-frame-changing-page={changingPage ? "" : undefined}
            style={BOX_STYLE}
            {...(changingPage ? SWALLOW_PRESS_HANDLERS : {})}
        >
            {children}
        </div>
    );
}
