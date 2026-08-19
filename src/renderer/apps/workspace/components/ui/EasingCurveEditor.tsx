import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
    clampStoryBezierPoints,
    formatStoryBezierEasing,
    storyBezierPoints,
    STORY_BEZIER_Y_MAX,
    STORY_BEZIER_Y_MIN,
    STORY_DEFAULT_BEZIER_EASING,
    type StoryBezierPoints,
} from "@shared/utils/storyEasing";
import { useFreezeGuard } from "./freezeGuard";

/**
 * The curve card: two draggable handles over a `cubic-bezier(…)`, and the value they spell.
 *
 * One component for both surfaces that offer a custom easing — the Story Motion keyframe inspector,
 * which had the only copy of it, and every `Easing` field in the action inspector, which now offers
 * the same choice. A second copy would have been a second gesture and a second set of clamps for one
 * setting; the shape an author drags in a keyframe is the shape they drag in a transition.
 *
 * The card draws no label of its own. It appears directly under the field that opened it, so the
 * field's label already names it, and a second word there would only say "easing" twice.
 */
export function EasingCurveEditor(props: { easing: string; onChange: (easing: string) => void }) {
    // Dragging a handle rewrites the stored easing on every pointer move. The read-only clamp a
    // properties framework puts around a field is a `disabled` fieldset, and that reaches form
    // controls only - an SVG circle is not one, so on a frozen project the curve could still be
    // dragged into a new shape that was discarded on thaw. The gesture goes away entirely rather
    // than half-attaching: a handle that picks up and refuses to move reads as a broken editor -
    // and the grab cursor goes with it, since it is the handle's only promise that it can be moved.
    const freeze = useFreezeGuard();
    const svgRef = useRef<SVGSVGElement | null>(null);
    const points = storyBezierPoints(props.easing) ?? storyBezierPoints(STORY_DEFAULT_BEZIER_EASING)!;

    const toX = (value: number) => value * VIEW_SIZE;
    const toY = (value: number) => (STORY_BEZIER_Y_MAX - value) / (STORY_BEZIER_Y_MAX - STORY_BEZIER_Y_MIN) * VIEW_SIZE;

    const startHandleDrag = (event: ReactPointerEvent<SVGCircleElement>, handle: 0 | 1) => {
        event.preventDefault();
        event.stopPropagation();
        const svg = svgRef.current;
        if (!svg) {
            return;
        }
        const onMove = (moveEvent: PointerEvent) => {
            const rect = svg.getBoundingClientRect();
            const x = (moveEvent.clientX - rect.left) / rect.width;
            const y = STORY_BEZIER_Y_MAX - (moveEvent.clientY - rect.top) / rect.height * (STORY_BEZIER_Y_MAX - STORY_BEZIER_Y_MIN);
            const next: StoryBezierPoints = handle === 0
                ? [x, y, points[2], points[3]]
                : [points[0], points[1], x, y];
            props.onChange(formatStoryBezierEasing(clampStoryBezierPoints(next)));
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const handle = (index: 0 | 1) => (
        <circle
            cx={toX(points[index * 2])}
            cy={toY(points[index * 2 + 1])}
            r={5}
            style={{ fill: "rgb(var(--nl-primary))", stroke: "rgb(var(--nl-fg) / 0.8)" }}
            className={freeze.frozen ? undefined : "cursor-grab"}
            onPointerDown={freeze.gesture((event: ReactPointerEvent<SVGCircleElement>) => startHandleDrag(event, index))}
        />
    );

    // Capped rather than free: the card is square, so in a wide inspector column an uncapped one
    // would grow into a panel the field is a caption for. Small is what it is - a curve to nudge.
    return (
        <div className="grid max-w-56 gap-1.5">
            <svg
                ref={svgRef}
                viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
                className="w-full touch-none rounded-md border border-edge bg-fill-subtle"
            >
                {/* The band between "not started" and "finished" — everything outside it is overshoot. */}
                <rect x={0} y={toY(1)} width={VIEW_SIZE} height={toY(0) - toY(1)} style={{ fill: "var(--nl-fill-subtle)" }} />
                <line x1={0} y1={toY(0)} x2={VIEW_SIZE} y2={toY(0)} style={{ stroke: "var(--nl-edge)" }} strokeWidth={1} />
                <line x1={0} y1={toY(1)} x2={VIEW_SIZE} y2={toY(1)} style={{ stroke: "var(--nl-edge)" }} strokeWidth={1} />
                <line x1={toX(0)} y1={toY(0)} x2={toX(points[0])} y2={toY(points[1])} style={{ stroke: "rgb(var(--nl-fg-muted) / 0.5)" }} strokeWidth={1} />
                <line x1={toX(1)} y1={toY(1)} x2={toX(points[2])} y2={toY(points[3])} style={{ stroke: "rgb(var(--nl-fg-muted) / 0.5)" }} strokeWidth={1} />
                <path
                    d={`M ${toX(0)} ${toY(0)} C ${toX(points[0])} ${toY(points[1])}, ${toX(points[2])} ${toY(points[3])}, ${toX(1)} ${toY(1)}`}
                    fill="none"
                    style={{ stroke: "rgb(var(--nl-primary))" }}
                    strokeWidth={2}
                />
                {handle(0)}
                {handle(1)}
            </svg>
            <div className="text-center text-2xs tabular-nums text-fg-subtle">{formatStoryBezierEasing(points)}</div>
        </div>
    );
}

/** The square the curve is drawn in, in user units — the viewBox, not a pixel size. */
const VIEW_SIZE = 160;
