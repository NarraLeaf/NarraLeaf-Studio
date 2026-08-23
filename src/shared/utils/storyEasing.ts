export type StoryEasingValue = string | [number, number, number, number];

/** The four control-point numbers of a `cubic-bezier(…)`, in the order the CSS function states them. */
export type StoryBezierPoints = [number, number, number, number];

const CUBIC_BEZIER_PATTERN = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/i;

/**
 * The curve a custom easing starts from: the CSS `ease-in-out`.
 *
 * A named easing is what an author leaves behind when they ask for a custom one, so the first shape
 * they see has to be a curve they recognise rather than a straight line - the editor opens on
 * something to adjust, not on something to build from nothing.
 */
export const STORY_DEFAULT_BEZIER_EASING = "cubic-bezier(0.42,0,0.58,1)";

/**
 * The x components are the two handles' positions along time and cannot leave the duration; the y
 * components may overshoot in both directions, which is what an anticipate or a bounce is made of.
 */
export const STORY_BEZIER_Y_MIN = -0.5;
export const STORY_BEZIER_Y_MAX = 1.5;

/**
 * Parses a story keyframe easing string into the value NarraLeaf React accepts:
 * named easings pass through, `cubic-bezier(x1, y1, x2, y2)` becomes a bezier tuple.
 */
export function parseStoryEasing(easing: string | undefined): StoryEasingValue | undefined {
    if (easing === undefined || easing === "") {
        return undefined;
    }
    const match = CUBIC_BEZIER_PATTERN.exec(easing.trim());
    if (!match) {
        return easing;
    }
    const points = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
    if (points.some(point => !Number.isFinite(point))) {
        return easing;
    }
    return points as StoryBezierPoints;
}

/**
 * Whether this stored easing is a drawn curve rather than one of the named ones.
 *
 * The stored field is one string either way — there is no "custom" flag beside it — so this is what
 * every surface that has to tell the two apart asks: the select showing which option is picked, the
 * card deciding whether to appear, and the command line deciding whether the value is a word.
 */
export function isStoryBezierEasing(easing: string | undefined): boolean {
    return Array.isArray(parseStoryEasing(easing));
}

/** The four numbers of a drawn curve, or `null` when the easing is a named one. */
export function storyBezierPoints(easing: string | undefined): StoryBezierPoints | null {
    const parsed = parseStoryEasing(easing);
    return Array.isArray(parsed) ? parsed : null;
}

/**
 * A curve as the one string every layer stores it as.
 *
 * Written WITHOUT spaces, because the story row is a command line: a value carrying spaces is a value
 * the tokenizer has to see quoted, and `ease='cubic-bezier(0.42, 0, 0.58, 1)'` is a row nobody would
 * type back. `parseStoryEasing` still reads the spaced spelling, so a project written before this
 * keeps working - only what Studio writes changed.
 */
export function formatStoryBezierEasing(points: readonly number[]): string {
    return `cubic-bezier(${points.map(point => roundBezierPoint(point)).join(",")})`;
}

/** A dragged handle, held inside the range the curve is drawn in. */
export function clampStoryBezierPoints(points: readonly number[]): StoryBezierPoints {
    return [
        clamp(points[0], 0, 1),
        clamp(points[1], STORY_BEZIER_Y_MIN, STORY_BEZIER_Y_MAX),
        clamp(points[2], 0, 1),
        clamp(points[3], STORY_BEZIER_Y_MIN, STORY_BEZIER_Y_MAX),
    ];
}

function clamp(value: number, min: number, max: number): number {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function roundBezierPoint(value: number): number {
    return Math.round(value * 100) / 100;
}

/** The named shape a preset button stands for. */
export type StoryBezierPresetId = "linear" | "easeIn" | "easeOut" | "easeInOut";

export type StoryBezierPreset = {
    readonly id: StoryBezierPresetId;
    readonly points: StoryBezierPoints;
};

/**
 * The four shapes the curve editor offers as one click each, in the CSS spelling of them.
 *
 * They are the same four curves the easing word list already names, which is the point: a curve
 * editor that opens on a hand-drawn shape gives an author no way back to a plain ease-in, and
 * leaving the editor to pick the word instead would throw away the curve they came to adjust. The
 * numbers are the CSS keyword definitions (`ease-in` is `cubic-bezier(0.42,0,1,1)`), so a preset
 * and the word that names it are the same motion.
 */
export const STORY_BEZIER_PRESETS: readonly StoryBezierPreset[] = [
    { id: "linear", points: [0, 0, 1, 1] },
    { id: "easeIn", points: [0.42, 0, 1, 1] },
    { id: "easeOut", points: [0, 0, 0.58, 1] },
    { id: "easeInOut", points: [0.42, 0, 0.58, 1] },
];

/**
 * Which preset this curve is, or `null` when it is a shape of the author's own.
 *
 * Compared with a tolerance rather than exactly, because the stored numbers are rounded to two
 * decimals on the way out and a handle dragged onto a preset's position lands on it to within less
 * than that. Half of the rounding step is the widest tolerance that still cannot claim one preset
 * while the author is looking at another - the closest two differ by 0.42 in x.
 */
export function matchStoryBezierPreset(points: readonly number[]): StoryBezierPresetId | null {
    const preset = STORY_BEZIER_PRESETS.find(candidate =>
        candidate.points.every((value, index) => Math.abs(value - (points[index] ?? Number.NaN)) <= 0.005));
    return preset ? preset.id : null;
}

/**
 * A curve typed or pasted into the editor's value field, or `null` when it says no curve.
 *
 * Deliberately looser than {@link parseStoryEasing}, which reads what Studio stores: this reads what
 * a person has in the clipboard. A curve arrives from a browser's dev tools, a CSS file or a design
 * tool's export, so `cubic-bezier(.25, .1, .25, 1)` and a bare `.25 .1 .25 1` both have to land -
 * anything else makes the author retype numbers they are holding.
 */
export function parseStoryBezierInput(text: string): StoryBezierPoints | null {
    const inner = text.trim().replace(/^cubic-bezier\s*\(/i, "").replace(/\)$/, "");
    const parts = inner.split(/[\s,]+/).filter(part => part !== "");
    if (parts.length !== 4) {
        return null;
    }
    const points = parts.map(Number);
    return points.every(point => Number.isFinite(point)) ? points as StoryBezierPoints : null;
}
