import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useHostDocument } from "@/lib/components/layout/hostWindow";
import { getTooltipDelay, placeTooltip, TOOLTIP_BUBBLE_CLASS } from "@/lib/tooltip";
import { BLUEPRINT_EXEC_EDGE_COLOR } from "@/lib/ui-editor/blueprint-graph-edge-style";
import type { BlueprintWireEnd } from "../blueprintWireEnds";

/**
 * The attribute the canvas root carries, naming the canvas so the rules below reach its cards and
 * wires and no other canvas's. Two blueprint tabs can be mounted at once - a kept-alive tab is only
 * hidden - and the same graph open in both would otherwise light up twice.
 */
export const BLUEPRINT_CANVAS_ATTRIBUTE = "data-blueprint-canvas";

/** The wire under the pointer, and what its tooltip says. */
export type BlueprintWireHover = {
    edgeId: string;
    source: BlueprintWireEnd;
    target: BlueprintWireEnd;
    /** The wire's own colour: an execution wire and a data wire mark their ends in their colour. */
    color: string;
    /** The far end, named; drawn beside the pointer once the tooltip delay has passed. */
    tip: string;
    clientX: number;
    clientY: number;
};

/** A node the canvas has just been moved to, and the pin on it that was being followed. */
export type BlueprintWireArrival = { end: BlueprintWireEnd; color: string };

export type BlueprintWireEmphasisHandle = {
    /** The wire under the pointer, or null once the pointer has left it. */
    hoverWire: (hover: BlueprintWireHover | null) => void;
    /** Mark the node a jump landed on, for long enough to find it. */
    markArrival: (arrival: BlueprintWireArrival) => void;
};

/** How long the arrival mark stays; matches `narraleaf-blueprint-arrive` in styles.css. */
const ARRIVAL_MS = 1600;

/** Room the bubble keeps from the pointer, which is drawn below and to the right of its hot spot. */
const POINTER_BOX_PX = 10;

/**
 * Only the two forms the edge style writes - a hex colour or an `rgb()` - are put into a rule: the
 * value comes from an inline style, and a rule is no place for whatever else might be there.
 */
function safeColor(value: string): string {
    return /^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\([\d\s.,%/]+\)$/i.test(value) ? value : BLUEPRINT_EXEC_EDGE_COLOR;
}

function quoted(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r\f]/g, " ")}"`;
}

/**
 * The rules that make a hovered wire and its two ends stand out, and the node a jump landed on.
 *
 * A stylesheet rather than props on the nodes and edges: the canvas is the expensive tree on the
 * page, and a pointer crossing a graph enters and leaves wires all the time. Written as rules, the
 * emphasis costs this small component a render and React Flow nothing - no node or edge object
 * changes, so no card re-renders, and a document revision arriving mid-hover cannot wipe it.
 */
export function blueprintWireEmphasisCss(
    canvasId: string,
    hover: Pick<BlueprintWireHover, "edgeId" | "source" | "target" | "color"> | null,
    arrival: BlueprintWireArrival | null,
): string {
    const scope = `[${BLUEPRINT_CANVAS_ATTRIBUTE}=${quoted(canvasId)}]`;
    const node = (id: string) => `${scope} .react-flow__node[data-id=${quoted(id)}]`;
    const pin = (end: BlueprintWireEnd) =>
        `${scope} .react-flow__handle[data-nodeid=${quoted(end.nodeId)}][data-handleid=${quoted(end.pinId)}]`;
    const rules: string[] = [];
    if (hover) {
        const color = safeColor(hover.color);
        rules.push(
            `${scope} .react-flow__edge[data-id=${quoted(hover.edgeId)}] .react-flow__edge-path { stroke-width: 3px !important; }`,
            `${node(hover.source.nodeId)}, ${node(hover.target.nodeId)} { outline: 1.5px solid ${color}; outline-offset: 3px; border-radius: 6px; }`,
            `${pin(hover.source)}, ${pin(hover.target)} { box-shadow: 0 0 0 2px ${color}; }`,
        );
    }
    if (arrival) {
        const color = safeColor(arrival.color);
        rules.push(
            `${node(arrival.end.nodeId)} { --nl-blueprint-arrive: ${color}; border-radius: 6px; animation: narraleaf-blueprint-arrive ${ARRIVAL_MS}ms ease-out both; }`,
            `${pin(arrival.end)} { box-shadow: 0 0 0 2px ${color}; }`,
        );
    }
    return rules.join("\n");
}

/**
 * What the canvas draws over itself for its wires: the emphasis on a hovered wire and its two ends,
 * the tooltip that names the far end, and the brief mark on a node a jump has just brought into view.
 *
 * It owns that state, so the canvas does not have to: the canvas calls the handle from its wire
 * events and never reads anything back, and a pointer moving along a wire renders this and nothing
 * else - the same arrangement as the creation menu's host.
 *
 * The tooltip is the window's tooltip in every way that shows - its bubble, its delay, the gestures
 * that put it away - but drawn here, beside the pointer: a wire is an SVG path that can be half a
 * graph long, so there is no element to anchor it to, and the end it names changes as the pointer
 * moves along it.
 */
export const BlueprintWireEmphasis = forwardRef<BlueprintWireEmphasisHandle, { canvasId: string }>(
    function BlueprintWireEmphasis({ canvasId }, ref) {
        const doc = useHostDocument();
        const [hover, setHover] = useState<BlueprintWireHover | null>(null);
        const [tipShown, setTipShown] = useState(false);
        const [arrival, setArrival] = useState<BlueprintWireArrival | null>(null);
        const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
        /** The wire the running wait, or the showing tooltip, belongs to. */
        const tipEdgeRef = useRef<string | null>(null);
        const arrivalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
        const arrivalFrameRef = useRef(0);

        const cancelTimer = useCallback(() => {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        }, []);

        /** Put the tooltip away and forget the wire it was for, so moving on along it waits again. */
        const dismissTip = useCallback(() => {
            cancelTimer();
            tipEdgeRef.current = null;
            setTipShown(false);
        }, [cancelTimer]);

        const hoverWire = useCallback(
            (next: BlueprintWireHover | null) => {
                setHover(next);
                if (!next) {
                    dismissTip();
                    return;
                }
                // The wait belongs to the wire, not to the pointer event: a resting hand still sends
                // moves, and restarting on each would be a tooltip that never arrives.
                if (tipEdgeRef.current === next.edgeId) {
                    return;
                }
                cancelTimer();
                setTipShown(false);
                tipEdgeRef.current = next.edgeId;
                timerRef.current = setTimeout(() => {
                    timerRef.current = null;
                    setTipShown(true);
                }, getTooltipDelay());
            },
            [cancelTimer, dismissTip],
        );

        const markArrival = useCallback((next: BlueprintWireArrival) => {
            if (arrivalTimerRef.current !== null) {
                clearTimeout(arrivalTimerRef.current);
            }
            const view = doc.defaultView;
            if (view && arrivalFrameRef.current) {
                view.cancelAnimationFrame(arrivalFrameRef.current);
            }
            // Cleared for a frame first, so following a second wire to the same node starts the
            // mark over instead of leaving the first one to finish fading.
            setArrival(null);
            const start = () => {
                arrivalFrameRef.current = 0;
                setArrival(next);
                arrivalTimerRef.current = setTimeout(() => {
                    arrivalTimerRef.current = null;
                    setArrival(null);
                }, ARRIVAL_MS);
            };
            if (view) {
                arrivalFrameRef.current = view.requestAnimationFrame(start);
            } else {
                start();
            }
        }, [doc]);

        useImperativeHandle(ref, () => ({ hoverWire, markArrival }), [hoverWire, markArrival]);

        // The gestures that put every other tooltip away put this one away too, and stop one that is
        // still waiting: a press on a wire is a click or the start of a double-click, not a pause.
        const hovering = hover !== null;
        useEffect(() => {
            if (!hovering) {
                return undefined;
            }
            const view = doc.defaultView;
            const options = { passive: true, capture: true } as const;
            doc.addEventListener("pointerdown", dismissTip, options);
            doc.addEventListener("keydown", dismissTip, options);
            doc.addEventListener("wheel", dismissTip, options);
            view?.addEventListener("blur", dismissTip);
            return () => {
                doc.removeEventListener("pointerdown", dismissTip, true);
                doc.removeEventListener("keydown", dismissTip, true);
                doc.removeEventListener("wheel", dismissTip, true);
                view?.removeEventListener("blur", dismissTip);
            };
        }, [dismissTip, doc, hovering]);

        useEffect(
            () => () => {
                cancelTimer();
                if (arrivalTimerRef.current !== null) {
                    clearTimeout(arrivalTimerRef.current);
                }
                if (arrivalFrameRef.current) {
                    doc.defaultView?.cancelAnimationFrame(arrivalFrameRef.current);
                }
            },
            [cancelTimer, doc],
        );

        const css = blueprintWireEmphasisCss(canvasId, hover, arrival);
        return (
            <>
                {css ? <style>{css}</style> : null}
                {hover && tipShown ? <WireTooltip doc={doc} hover={hover} /> : null}
            </>
        );
    },
);

/** The bubble, placed like every other tooltip around a small box at the pointer. */
function WireTooltip({ doc, hover }: { doc: Document; hover: BlueprintWireHover }) {
    const bubbleRef = useRef<HTMLDivElement | null>(null);
    const [style, setStyle] = useState<CSSProperties | null>(null);

    useLayoutEffect(() => {
        const bubble = bubbleRef.current;
        const view = doc.defaultView;
        if (!bubble || !view) {
            return;
        }
        const anchor = {
            left: hover.clientX - POINTER_BOX_PX,
            top: hover.clientY - POINTER_BOX_PX,
            right: hover.clientX + POINTER_BOX_PX,
            bottom: hover.clientY + POINTER_BOX_PX,
            width: POINTER_BOX_PX * 2,
            height: POINTER_BOX_PX * 2,
        };
        const placed = placeTooltip("top", anchor, bubble.getBoundingClientRect(), view.innerWidth, view.innerHeight);
        setStyle({ position: "fixed", top: Math.round(placed.top), left: Math.round(placed.left) });
    }, [doc, hover.clientX, hover.clientY, hover.tip]);

    return createPortal(
        <div
            ref={bubbleRef}
            role="tooltip"
            style={style ?? { position: "fixed", top: 0, left: 0, visibility: "hidden" }}
            className={TOOLTIP_BUBBLE_CLASS}
        >
            {hover.tip}
        </div>,
        doc.body,
    );
}
