/**
 * The outline a group draws while a card is being dropped into it.
 *
 * Grouping is decided by geometry rather than by a stored member list, which leaves a drag with
 * nothing to say: the frame does not move, so dropping a card inside one looked exactly like
 * dropping it on the canvas. This is what says otherwise - the frame the card is aimed at is ringed
 * while the pointer is over it, at the size it is about to become, so the author sees the group
 * open up before letting go rather than guessing afterwards.
 *
 * It is driven through a handle rather than props on purpose. The rectangle changes on every
 * pointer move of a drag, and the canvas around it is a large component with a graph in it; keeping
 * the value here means a drag re-renders one absolutely-positioned div and nothing else.
 *
 * Comments in English per project convention.
 */

import { forwardRef, useImperativeHandle, useState } from "react";
import { ViewportPortal } from "@xyflow/react";
import type { BlueprintFrameRect } from "../blueprintGroupFrame";
import { BLUEPRINT_FLOW_Z_EDGE } from "../useBlueprintFlowProjection";

export type BlueprintGroupDropPreviewState = {
    /** Where the frame will stand once the drop is applied, not where it stands now. */
    rect: BlueprintFrameRect;
    /** The frame's own colour, so the outline belongs to the group it belongs to. */
    color: string;
};

export type BlueprintGroupDropPreviewHandle = {
    show: (next: BlueprintGroupDropPreviewState) => void;
    clear: () => void;
};

export const BlueprintGroupDropPreview = forwardRef<BlueprintGroupDropPreviewHandle>(
    function BlueprintGroupDropPreview(_props, ref) {
        const [state, setState] = useState<BlueprintGroupDropPreviewState | null>(null);
        useImperativeHandle(ref, () => ({ show: setState, clear: () => setState(null) }), []);

        if (!state) {
            return null;
        }
        const { rect, color } = state;
        return (
            <ViewportPortal>
                <div
                    // Flow coordinates, so it tracks the frame through pan and zoom the way the
                    // frame itself does. It is a hint about a gesture in progress and never a
                    // target: every pixel of it belongs to whatever is drawn underneath.
                    className="pointer-events-none absolute rounded-md"
                    style={{
                        transform: `translate(${rect.x}px, ${rect.y}px)`,
                        width: rect.width,
                        height: rect.height,
                        border: `2px dashed ${color}`,
                        boxShadow: `0 0 0 1px ${color}`,
                        // Above every frame - including the one it is drawn for, which is stacked
                        // behind the graph - and below the cards it is opening up to receive.
                        zIndex: BLUEPRINT_FLOW_Z_EDGE,
                    }}
                />
            </ViewportPortal>
        );
    },
);
