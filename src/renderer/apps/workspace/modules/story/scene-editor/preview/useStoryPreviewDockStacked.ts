import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { storyPreviewDockFitsBeside } from "./storyPreviewDockLayout";

/**
 * Whether the docked preview has to sit under the script rather than beside it, kept current as the
 * editor body is resized - by the window, by a sidebar opening or closing, by the editor being split.
 *
 * Only the answer is state, so the tab renders when the answer changes and not on every frame of a
 * resize: within either arrangement the browser sizes both columns itself (see
 * `resolveStoryPreviewDockLayout`). The change is flushed inside the observer's callback, before the
 * frame is painted, so the frame in which the two minimums no longer fit side by side is never drawn.
 *
 * A body with no width is a tab kept alive behind another one. It has nothing to say about where the
 * preview goes, so the last answer stands until the tab is shown again.
 */
export function useStoryPreviewDockStacked(
    body: HTMLElement | null,
    docked: boolean,
    scriptMinWidth: number,
): boolean {
    const [stacked, setStacked] = useState(false);
    // The answer as last given, for the observer to compare against; it is only ever changed
    // together with the state, so the two cannot disagree.
    const stackedRef = useRef(false);

    useLayoutEffect(() => {
        if (!docked || !body) {
            return;
        }
        const evaluate = (flush: boolean) => {
            const bodyWidth = body.getBoundingClientRect().width;
            if (bodyWidth < 1) {
                return;
            }
            const next = !storyPreviewDockFitsBeside(bodyWidth, scriptMinWidth);
            if (next === stackedRef.current) {
                return;
            }
            stackedRef.current = next;
            if (flush) {
                flushSync(() => setStacked(next));
            } else {
                setStacked(next);
            }
        };
        evaluate(false);
        if (typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(() => evaluate(true));
        observer.observe(body);
        return () => observer.disconnect();
    }, [body, docked, scriptMinWidth]);

    return docked && stacked;
}
