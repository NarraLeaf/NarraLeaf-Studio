import { useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { RotateCcw } from "lucide-react";
import {
    clampStoryBezierPoints,
    formatStoryBezierEasing,
    matchStoryBezierPreset,
    parseStoryBezierInput,
    storyBezierPoints,
    STORY_BEZIER_PRESETS,
    STORY_BEZIER_Y_MAX,
    STORY_BEZIER_Y_MIN,
    STORY_DEFAULT_BEZIER_EASING,
    type StoryBezierPoints,
} from "@shared/utils/storyEasing";
import { useTranslation } from "@/lib/i18n";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { cn } from "@/lib/utils/cn";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";
import { useFreezeGuard } from "./freezeGuard";

/**
 * The curve editor: a value graph of the easing, shaped the way a video editor shapes one.
 *
 * One component for every surface that offers a custom easing - the Story Motion keyframe
 * inspector, every `Easing` field in the action inspector, and the story row's inline value
 * popover. A second copy would have been a second gesture and a second set of clamps for one
 * setting; the shape an author drags in a keyframe is the shape they drag in a transition.
 *
 * It is drawn as a graph rather than as a bare square because that is the drawing authors already
 * know from a timeline: progress runs left to right, the value runs bottom to top, the two flat
 * lines are "not started" and "finished", and the band outside them is overshoot. The endpoints are
 * keyframes and cannot move - a `cubic-bezier` starts at 0 and ends at 1 by definition - so they
 * are drawn as the diamonds a timeline uses for a key, with one tangent handle each. That is
 * exactly the anatomy of the four numbers: the two handles ARE the two control points.
 *
 * Three ways in, because a curve arrives three ways: the presets for "just make it ease out", the
 * handles for shaping it by eye, and the value field for a `cubic-bezier(…)` pasted from a browser's
 * dev tools or a design tool. The field is the same string the document stores, so what an author
 * reads there is what the story row prints.
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
    const { t } = useTranslation();
    const svgRef = useRef<SVGSVGElement | null>(null);
    /** Which handle the author is on right now - focused or being dragged - so it draws its ring. */
    const [activeHandle, setActiveHandle] = useState<0 | 1 | null>(null);
    /**
     * What is typed in the value field while it is being typed in, or `null` when nothing is.
     *
     * The field cannot write through on every keystroke: half-typed text is not a curve, and
     * `cubic-bezier(0.4` parses to nothing, so the graph would empty out under the author's hands.
     */
    const [draft, setDraft] = useState<string | null>(null);
    const points = storyBezierPoints(props.easing) ?? storyBezierPoints(STORY_DEFAULT_BEZIER_EASING)!;
    const value = formatStoryBezierEasing(points);
    const preset = matchStoryBezierPreset(points);

    const write = (next: readonly number[]) => props.onChange(formatStoryBezierEasing(clampStoryBezierPoints(next)));
    const moveHandle = (handle: 0 | 1, x: number, y: number) => {
        const next: StoryBezierPoints = handle === 0 ? [x, y, points[2], points[3]] : [points[0], points[1], x, y];
        write(next);
    };

    const startHandleDrag = (event: ReactPointerEvent<SVGCircleElement>, handle: 0 | 1) => {
        event.preventDefault();
        event.stopPropagation();
        const svg = svgRef.current;
        if (!svg) {
            return;
        }
        // `preventDefault` above stops the browser from moving focus here on its own, and the
        // keyboard nudge needs the handle focused to be reachable at all - so the drag hands it over.
        event.currentTarget.focus?.();
        setActiveHandle(handle);
        const onMove = (moveEvent: PointerEvent) => {
            const rect = svg.getBoundingClientRect();
            const x = fromViewX((moveEvent.clientX - rect.left) / rect.width * VIEW_W);
            const y = fromViewY((moveEvent.clientY - rect.top) / rect.height * VIEW_H);
            // Shift snaps to the grid the graph is drawn on, which is how a timeline behaves and the
            // only way to land on a round number with a pointer.
            moveHandle(handle, snap(x, moveEvent.shiftKey), snap(y, moveEvent.shiftKey));
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    /**
     * Arrow keys nudge the focused handle, Shift by ten steps.
     *
     * A pointer cannot state 0.42 on a 190px graph, and matching a curve someone else specified is
     * most of what a custom easing is for. The step is the rounding step the stored value uses, so
     * every nudge lands on a number the document can hold exactly.
     */
    const nudgeHandle = (event: ReactKeyboardEvent<SVGCircleElement>, handle: 0 | 1) => {
        const delta = ARROW_DELTAS[event.key];
        if (!delta) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 0.1 : 0.01;
        moveHandle(handle, points[handle * 2] + delta[0] * step, points[handle * 2 + 1] + delta[1] * step);
    };

    const commitDraft = () => {
        const typed = draft === null ? null : parseStoryBezierInput(draft);
        setDraft(null);
        if (typed) {
            // Clamped like a dragged handle: a pasted curve may state a time outside the duration or
            // an overshoot past what the graph can draw, and the editor holds one range either way.
            write(typed);
        }
    };

    const anchor = (at: 0 | 1) => {
        const x = toViewX(at);
        const y = toViewY(at);
        return (
            <path
                key={at}
                d={`M ${x} ${y - KEY_SIZE} L ${x + KEY_SIZE} ${y} L ${x} ${y + KEY_SIZE} L ${x - KEY_SIZE} ${y} Z`}
                style={{ fill: "rgb(var(--nl-primary))" }}
            />
        );
    };

    const handle = (index: 0 | 1) => {
        const x = toViewX(points[index * 2]);
        const y = toViewY(points[index * 2 + 1]);
        const label = t(index === 0 ? "storyInspector.curve.startHandle" : "storyInspector.curve.endHandle");
        return (
            <g key={index}>
                <line
                    x1={toViewX(index)}
                    y1={toViewY(index)}
                    x2={x}
                    y2={y}
                    style={{ stroke: "rgb(var(--nl-fg-muted) / 0.6)" }}
                    strokeWidth={1}
                />
                {activeHandle === index ? (
                    <circle cx={x} cy={y} r={8} fill="none" style={{ stroke: "rgb(var(--nl-primary) / 0.35)" }} strokeWidth={2} />
                ) : null}
                <circle
                    cx={x}
                    cy={y}
                    r={4}
                    style={{ fill: "rgb(var(--nl-surface-raised))", stroke: "rgb(var(--nl-primary))" }}
                    strokeWidth={2}
                />
                {/*
                  * The gesture rides an invisible circle two and a half times the drawn one: a 4px
                  * knob is a target nobody can hit on the first try, and widening the knob itself
                  * would bury the curve under it.
                  */}
                <circle
                    cx={x}
                    cy={y}
                    r={10}
                    fill="transparent"
                    role="button"
                    aria-label={`${label} ${points[index * 2]}, ${points[index * 2 + 1]}`}
                    data-tip={`${label}\n${points[index * 2]}, ${points[index * 2 + 1]}`}
                    tabIndex={freeze.frozen ? -1 : 0}
                    className={cn("outline-none", !freeze.frozen && "cursor-grab")}
                    onFocus={() => setActiveHandle(index)}
                    onBlur={() => setActiveHandle(current => (current === index ? null : current))}
                    onPointerDown={freeze.gesture((event: ReactPointerEvent<SVGCircleElement>) => startHandleDrag(event, index))}
                    onKeyDown={freeze.gesture((event: ReactKeyboardEvent<SVGCircleElement>) => nudgeHandle(event, index))}
                />
            </g>
        );
    };

    // One frame around all three strips - the presets, the ruler and plot, the value - the way a
    // graph editor is one panel rather than a graph with controls scattered around it. Everything
    // that states a number is inside it, including the ruler: numbers sitting on the panel behind
    // the card read as a caption someone forgot to place.
    //
    // As wide as the field above it, too: the card sits directly under a select that fills the
    // column, and a graph stopping short of that edge reads as a control that failed to lay itself
    // out rather than as a deliberate size. The height follows from the `viewBox`, so a wider column
    // gets a bigger graph rather than a stretched one.
    return (
        <div className="overflow-hidden rounded-md border border-edge bg-surface-sunken">
            <div className="flex items-center gap-0.5 border-b border-edge-subtle px-1 py-1">
                {/*
                  * The button's own hover text goes through the freeze guard rather than beside it:
                  * the guard supplies `data-tip` too, so a `data-tip` written next to the spread
                  * would be blanked by it the moment the workspace is not frozen.
                  */}
                {STORY_BEZIER_PRESETS.map(candidate => (
                    <ToolbarButton
                        key={candidate.id}
                        size="xs"
                        active={preset === candidate.id}
                        aria-label={t(`storyInspector.easing.${candidate.id}`)}
                        onClick={() => write(candidate.points)}
                        {...freeze.writes(false, t(`storyInspector.easing.${candidate.id}`))}
                    >
                        <PresetGlyph points={candidate.points} />
                    </ToolbarButton>
                ))}
                {/*
                  * Greyed on the default curve rather than hidden, and compared against the value
                  * the card normalises to: a project written before the spacing was settled stores
                  * the same curve with spaces in it, and it is still the curve the button resets to.
                  */}
                <span className="flex-1" />
                <ToolbarButton
                    size="xs"
                    aria-label={t("storyInspector.curve.reset")}
                    onClick={() => props.onChange(STORY_DEFAULT_BEZIER_EASING)}
                    {...freeze.writes(value === STORY_DEFAULT_BEZIER_EASING, t("storyInspector.curve.reset"))}
                >
                    <RotateCcw className="h-3.5 w-3.5" />
                </ToolbarButton>
            </div>

            <div className="flex items-stretch">
                {/*
                  * The ruler is markup rather than drawing: text inside a `viewBox` is scaled with
                  * the graph, so it would land on whatever size the column happens to be instead of
                  * on the one type scale.
                  */}
                <div className="relative w-9 shrink-0">
                    {VALUE_RULER.map(mark => (
                        <div
                            key={mark}
                            className={cn(
                                "absolute right-1.5 -translate-y-1/2 text-2xs tabular-nums",
                                mark === 0 || mark === 1 ? "text-fg-muted" : "text-fg-subtle",
                            )}
                            style={{ top: `${toViewY(mark) / VIEW_H * 100}%` }}
                        >
                            {mark.toFixed(1)}
                        </div>
                    ))}
                </div>
                <div className="min-w-0 flex-1">
                    <svg
                        ref={svgRef}
                        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                        className="block h-auto w-full touch-none"
                    >
                        {/* The band between "not started" and "finished" — everything outside it is overshoot. */}
                        <rect
                            x={0}
                            y={toViewY(1)}
                            width={VIEW_W}
                            height={toViewY(0) - toViewY(1)}
                            style={{ fill: "var(--nl-fill-subtle)" }}
                        />
                        {[0.25, 0.5, 0.75].map(at => (
                            <line
                                key={at}
                                x1={toViewX(at)}
                                y1={0}
                                x2={toViewX(at)}
                                y2={VIEW_H}
                                style={{ stroke: "var(--nl-edge-subtle)" }}
                                strokeWidth={1}
                                strokeDasharray="2 3"
                            />
                        ))}
                        <line x1={0} y1={toViewY(0.5)} x2={VIEW_W} y2={toViewY(0.5)} style={{ stroke: "var(--nl-edge-subtle)" }} strokeWidth={1} strokeDasharray="2 3" />
                        <line x1={0} y1={toViewY(0)} x2={VIEW_W} y2={toViewY(0)} style={{ stroke: "var(--nl-edge)" }} strokeWidth={1} />
                        <line x1={0} y1={toViewY(1)} x2={VIEW_W} y2={toViewY(1)} style={{ stroke: "var(--nl-edge)" }} strokeWidth={1} />
                        <path
                            d={`M ${toViewX(0)} ${toViewY(0)} C ${toViewX(points[0])} ${toViewY(points[1])}, ${toViewX(points[2])} ${toViewY(points[3])}, ${toViewX(1)} ${toViewY(1)}`}
                            fill="none"
                            strokeLinecap="round"
                            style={{ stroke: "rgb(var(--nl-primary))" }}
                            strokeWidth={2}
                        />
                        {anchor(0)}
                        {anchor(1)}
                        {handle(0)}
                        {handle(1)}
                    </svg>
                </div>
            </div>

            <input
                type="text"
                spellCheck={false}
                aria-label={t("storyInspector.curve.value")}
                // A strip of the card rather than a control in a row of controls, so it carries its
                // own height instead of the shared 28px floor - a bordered box here would have been
                // a second frame inside the frame.
                className={cn(
                    "w-full border-t border-edge-subtle bg-transparent px-1.5 py-1 text-center font-mono text-2xs tabular-nums",
                    "text-fg-muted transition-colors focus:bg-fill-subtle focus:text-fg",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                )}
                value={draft ?? value}
                onChange={event => setDraft(event.target.value)}
                onBlur={commitDraft}
                onKeyDown={event => {
                    // Nothing here belongs to the handler while an input method is composing:
                    // Enter confirms the conversion and Escape cancels it, both at the candidate
                    // window rather than at this field.
                    if (isImeKeyEvent(event)) {
                        return;
                    }
                    // Both keys are handled here and stop there: the surfaces this card opens on -
                    // a popover over the story row, an inspector inside the editor - read Enter and
                    // Escape as "commit the row" and "close me", and neither is what a value field
                    // being typed in means by them.
                    if (event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        commitDraft();
                    } else if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        setDraft(null);
                    }
                }}
                {...freeze.writes()}
            />
        </div>
    );
}

/** The curve a preset button draws on itself, at icon size. */
function PresetGlyph(props: { points: StoryBezierPoints }) {
    const gx = (at: number) => 3 + at * 10;
    const gy = (at: number) => 13 - at * 10;
    return (
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d={`M ${gx(0)} ${gy(0)} C ${gx(props.points[0])} ${gy(props.points[1])}, ${gx(props.points[2])} ${gy(props.points[3])}, ${gx(1)} ${gy(1)}`} />
        </svg>
    );
}

/**
 * The graph's drawing area, in user units - the `viewBox`, not a pixel size.
 *
 * Wider than it is tall, like the value graph in a timeline: time is the axis being read, and the
 * value axis is twice as tall as the 0..1 band because the overshoot room is drawn, not implied.
 */
const VIEW_W = 212;
const VIEW_H = 136;
/** Room for a handle sitting exactly on an edge to be drawn whole instead of clipped in half. */
const VIEW_PAD = 10;
/** Half the width of a keyframe diamond. */
const KEY_SIZE = 4;

/** The values the ruler names: the two that bound a finished motion, and the two that bound overshoot. */
const VALUE_RULER = [STORY_BEZIER_Y_MAX, 1, 0, STORY_BEZIER_Y_MIN];

const ARROW_DELTAS: Record<string, [number, number] | undefined> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
};

function toViewX(at: number): number {
    return VIEW_PAD + at * (VIEW_W - VIEW_PAD * 2);
}

function toViewY(value: number): number {
    return VIEW_PAD + (STORY_BEZIER_Y_MAX - value) / (STORY_BEZIER_Y_MAX - STORY_BEZIER_Y_MIN) * (VIEW_H - VIEW_PAD * 2);
}

function fromViewX(x: number): number {
    return (x - VIEW_PAD) / (VIEW_W - VIEW_PAD * 2);
}

function fromViewY(y: number): number {
    return STORY_BEZIER_Y_MAX - (y - VIEW_PAD) / (VIEW_H - VIEW_PAD * 2) * (STORY_BEZIER_Y_MAX - STORY_BEZIER_Y_MIN);
}

/** A dragged coordinate, on the graph's own grid while Shift is held. */
function snap(value: number, snapping: boolean): number {
    return snapping ? Math.round(value / 0.05) * 0.05 : value;
}
