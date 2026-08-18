import type { AppearanceTransitionTweenEasing } from "./appearance";

/**
 * How a widget moves one of its parts while it is in one of its states.
 *
 * Kept on the *parent* widget, never on the part: a part owns one private geometry, placed against
 * its own parent, and nothing in the editor may rewrite that behind the author's back. A state motion
 * is a layer the parent adds on top while it is in that state - the switch's thumb sits where the
 * author put it, and the switch slides it 24px while it is on.
 *
 * Deliberately small. It carries the channels a toggling widget needs and no more; anything richer is
 * a widget the author builds themselves out of containers, driven by blueprints.
 */
export type UIStateMotion = {
    /** The widget state this applies in, as the widget declares it (`on` for a switch). */
    state: string;
    /** Which child moves. */
    target: string;
    offsetX: number;
    offsetY: number;
    durationMs: number;
    easing: AppearanceTransitionTweenEasing;
};

/**
 * What a parent hands a child for the state it is in now, including the way back: an offset of zero
 * with a duration still means "move to zero over that long", which is what makes turning off animate.
 */
export type UIStateMotionOffset = {
    x: number;
    y: number;
    durationMs: number;
    easing: AppearanceTransitionTweenEasing;
};

export const DEFAULT_STATE_MOTION_DURATION_MS = 180;
export const DEFAULT_STATE_MOTION_EASING: AppearanceTransitionTweenEasing = "easeOut";

/** Clamp: a motion longer than this is a cutscene, not a control reacting to a click. */
export const MAX_STATE_MOTION_DURATION_MS = 5000;

const EASINGS: AppearanceTransitionTweenEasing[] = [
    "linear",
    "easeIn",
    "easeOut",
    "easeInOut",
    "circIn",
    "circOut",
    "circInOut",
];

function finiteOr(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeStateMotions(raw: unknown): UIStateMotion[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: UIStateMotion[] = [];
    for (const entry of raw) {
        const row = entry as Partial<UIStateMotion> | null;
        if (!row || typeof row.state !== "string" || typeof row.target !== "string" || !row.target) {
            continue;
        }
        out.push({
            state: row.state,
            target: row.target,
            offsetX: finiteOr(row.offsetX, 0),
            offsetY: finiteOr(row.offsetY, 0),
            durationMs: Math.max(
                0,
                Math.min(MAX_STATE_MOTION_DURATION_MS, finiteOr(row.durationMs, DEFAULT_STATE_MOTION_DURATION_MS)),
            ),
            easing: EASINGS.includes(row.easing as AppearanceTransitionTweenEasing)
                ? (row.easing as AppearanceTransitionTweenEasing)
                : DEFAULT_STATE_MOTION_EASING,
        });
    }
    return out;
}

export function getStateMotions(props: Record<string, unknown> | undefined): UIStateMotion[] {
    return normalizeStateMotions(props?.stateMotions);
}

/**
 * What `target` is offset by while the widget is in `state`.
 *
 * A state with no entry of its own resolves to zero rather than to nothing, so the part travels back
 * on the same terms it travelled out on - the timing comes from whichever entry names this target.
 */
export function resolveStateMotionOffset(
    motions: UIStateMotion[],
    state: string | null,
    target: string,
): UIStateMotionOffset | null {
    const forTarget = motions.filter(motion => motion.target === target);
    if (forTarget.length === 0) {
        return null;
    }
    const active = state === null ? undefined : forTarget.find(motion => motion.state === state);
    const timing = active ?? forTarget[0];
    return {
        x: active?.offsetX ?? 0,
        y: active?.offsetY ?? 0,
        durationMs: timing.durationMs,
        easing: timing.easing,
    };
}

export function upsertStateMotion(motions: UIStateMotion[], next: UIStateMotion): UIStateMotion[] {
    const index = motions.findIndex(motion => motion.state === next.state && motion.target === next.target);
    if (index < 0) {
        return [...motions, next];
    }
    const out = motions.slice();
    out[index] = next;
    return out;
}
