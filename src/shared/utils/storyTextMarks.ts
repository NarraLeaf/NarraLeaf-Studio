import type { StoryTextEmphasis, StoryTextMarks } from "@shared/types/story";

/**
 * The emphasis marks a run can carry, in the order the toolbar offers them.
 *
 * A closed list of four typographic conventions rather than the CSS matrix behind them (glyph ×
 * solid or hollow × which side of the line): an author picks the convention the language they are
 * writing in uses, and every combination outside these four is one no printed book sets.
 *
 * - `dot` — a solid dot above the line. Japanese 傍点, and the default.
 * - `circle` — a hollow circle above the line. Japanese 圏点.
 * - `sesame` — a solid sesame above the line, the older Japanese setting.
 * - `under-dot` — a solid dot below the line. Chinese 着重号.
 */
export const STORY_TEXT_EMPHASIS_VALUES = ["dot", "circle", "sesame", "under-dot"] as const;

export function isStoryTextEmphasis(value: unknown): value is StoryTextEmphasis {
    return typeof value === "string" && (STORY_TEXT_EMPHASIS_VALUES as readonly string[]).includes(value);
}

/** The engine's word config for one emphasis mark: which glyph, solid or hollow, and which side. */
export function storyEmphasisToWordConfig(emphasis: StoryTextEmphasis): {
    mark: "dot" | "circle" | "sesame";
    fill: "filled" | "open";
    position: "over" | "under";
} {
    switch (emphasis) {
        case "circle":
            return { mark: "circle", fill: "open", position: "over" };
        case "sesame":
            return { mark: "sesame", fill: "filled", position: "over" };
        case "under-dot":
            return { mark: "dot", fill: "filled", position: "under" };
        default:
            return { mark: "dot", fill: "filled", position: "over" };
    }
}

/**
 * How far one step of the size control moves a run, as a share of the line's size.
 *
 * Runs are sized in steps away from the line rather than in pixels, so a run keeps its weight
 * against the rest of the line whatever the line is set at — the dialogue box's own size, a
 * different size per platform, and the size text scaling settles on to fit the box.
 */
export const STORY_FONT_SIZE_STEP_RATIO = 1.125;
export const STORY_FONT_SIZE_STEP_MIN = -6;
export const STORY_FONT_SIZE_STEP_MAX = 6;

/** A step count clamped to what the control offers, or `undefined` for "the size of the line". */
export function clampFontSizeStep(value: unknown): number | undefined {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
        return undefined;
    }
    const step = Math.round(numeric);
    if (step === 0) {
        return undefined;
    }
    return Math.min(STORY_FONT_SIZE_STEP_MAX, Math.max(STORY_FONT_SIZE_STEP_MIN, step));
}

/** The multiplier `step` stands for, rounded to the precision a font size can tell apart. */
export function fontScaleForStep(step: number): number {
    return Number(Math.pow(STORY_FONT_SIZE_STEP_RATIO, step).toFixed(4));
}

/**
 * One run's marks as the engine's word config.
 *
 * The single place that says what a mark means to the runtime, so the compiler carries no second
 * opinion. Returns a plain record rather than the engine's `WordConfig`: this module is shared with
 * the main process, which has no business loading the engine to describe a size.
 */
export function storyMarksToWordConfig(marks: StoryTextMarks): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    if (marks.bold) config.bold = true;
    if (marks.italic) config.italic = true;
    if (marks.color) config.color = marks.color;
    if (marks.ruby) config.ruby = marks.ruby;
    if (typeof marks.cps === "number") config.cps = marks.cps;
    if (typeof marks.fontSize === "number") config.fontSize = marks.fontSize;
    // A step is a share of the line, which is what `fontScale` takes. An absolute `fontSize` still
    // wins in the engine, so a document carrying the legacy mark keeps the size it was written at.
    if (typeof marks.fontSizeStep === "number") config.fontScale = fontScaleForStep(marks.fontSizeStep);
    if (marks.emphasis) config.emphasis = storyEmphasisToWordConfig(marks.emphasis);
    return config;
}
