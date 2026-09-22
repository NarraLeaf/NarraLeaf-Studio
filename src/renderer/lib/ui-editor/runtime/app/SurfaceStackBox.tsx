import {
    createContext,
    useCallback,
    useContext,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react";
import { SWALLOW_PRESS_HANDLERS, useSwallowTouchGestures } from "@/lib/ui-editor/runtime/input/swallowPresses";

const NO_KEYS: ReadonlySet<string> = new Set();

const BOX_STYLE: CSSProperties = { pointerEvents: "none" };

const EXIT_GUARD_STYLE: CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "auto",
};

const LeavingSurfaceReportContext = createContext<((key: string, leaving: boolean) => void) | null>(null);

/**
 * The box a game app draws its pages and layers in, above the game stage.
 *
 * It takes no pointer input of its own: a page takes a press where one of its elements is drawn,
 * and everywhere else the press goes on down to the stage, which is how the dialogue box beside an
 * in-game menu or under a HUD stays clickable around it.
 *
 * Except while a page or layer is playing its exit. A leaving layer is taken out of hit testing
 * (see `SurfaceAnimationLayer`'s `inertWhileLeaving`), so a press made during the fade reaches what
 * is drawn beneath it - the page arriving in its place, or the page a closing layer was over. When
 * nothing is drawn beneath it, though, what is beneath it is the stage, and the stage turns a press
 * into the next line: a double press on Back to close a menu over a running game, or on Start as
 * the title fades out over the first line, would advance a line the player never read. So for as
 * long as anything is leaving, a sheet under every drawn layer takes the presses no layer took, and
 * the stage hears none of them. The story's own hold (`stageAdvanceHold`) does not cover this: it
 * lets go as soon as the page is off the stack, which is when its exit starts.
 *
 * The sheet is an element of its own under the layers rather than this box turning pointer events
 * on. The layers inherit from this box, and a page whose background inherited them would start
 * answering presses on its background for the length of some other page's exit.
 */
export function SurfaceStackBox(props: { className?: string; children: ReactNode }): ReactNode {
    const [leavingKeys, setLeavingKeys] = useState<ReadonlySet<string>>(NO_KEYS);
    const reportLeaving = useCallback((key: string, leaving: boolean) => {
        setLeavingKeys(previous => {
            if (previous.has(key) === leaving) {
                return previous;
            }
            const next = new Set(previous);
            if (leaving) {
                next.add(key);
            } else {
                next.delete(key);
            }
            return next;
        });
    }, []);
    return (
        <LeavingSurfaceReportContext.Provider value={reportLeaving}>
            <div className={props.className} style={BOX_STYLE}>
                {leavingKeys.size > 0 ? (
                    // First in the box and with no z-index, so it paints under every layer - an exit
                    // drawn behind the page it reveals included.
                    <ExitGuard />
                ) : null}
                {props.children}
            </div>
        </LeavingSurfaceReportContext.Provider>
    );
}

/**
 * The sheet that takes the presses no layer took while something is leaving, and ends them there.
 *
 * Taking them is not enough on its own. The game's drawing root, further up, offers every press that
 * reaches it to the global blueprint, so a press this sheet merely received would still bubble up and
 * could still be answered as "click advances" or "right click opens the menu" in a project that says
 * so - the same unasked-for action the sheet is here to prevent. So it stops them.
 */
function ExitGuard(): ReactNode {
    const guardRef = useRef<HTMLDivElement | null>(null);
    useSwallowTouchGestures(guardRef, true);
    return <div ref={guardRef} data-ui-surface-stack-exit-guard="" style={EXIT_GUARD_STYLE} {...SWALLOW_PRESS_HANDLERS} />;
}

/**
 * Tell the box around this layer, if there is one, whether the layer is playing its exit.
 *
 * A layout effect so the guard goes up in the same commit that takes the layer out of hit testing,
 * and comes down in the same commit that removes the layer: there is no frame between the two in
 * which a press could fall through to the stage.
 */
export function useReportLeavingSurface(key: string, leaving: boolean): void {
    const reportLeaving = useContext(LeavingSurfaceReportContext);
    useLayoutEffect(() => {
        if (!reportLeaving || !leaving) {
            return undefined;
        }
        reportLeaving(key, true);
        return () => reportLeaving(key, false);
    }, [key, leaving, reportLeaving]);
}
