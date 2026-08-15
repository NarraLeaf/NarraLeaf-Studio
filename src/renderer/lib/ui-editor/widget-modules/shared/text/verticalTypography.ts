import type { CSSProperties } from "react";

/**
 * Block flow of a box.
 *
 * `vertical-rl` is the classic Japanese novel setting a VN wants: columns of glyphs read top to
 * bottom, the next column to the left. `vertical-lr` is the same rotation with columns advancing
 * rightwards, which Mongolian and some modern layouts use.
 *
 * Declared here rather than on the text widget because it is not only text that turns: a list
 * whose entries are lines of a full-screen dialogue has to stack them the way the writing runs.
 */
export type TextWritingMode = "horizontal-tb" | "vertical-rl" | "vertical-lr";

/**
 * How glyphs sit inside a vertical column. Ignored while the box is horizontal.
 *
 * `mixed` is the convention: CJK stays upright and a Latin run is laid on its side, read by tilting
 * the head clockwise. `upright` stands every glyph up, which stacks Latin letter over letter.
 * `sideways` rotates the whole column, CJK included.
 */
export type TextOrientation = "mixed" | "upright" | "sideways";

/** The vertical settings a text-like widget carries; every text widget's props are a superset. */
export type VerticalTypographySettings = {
    writingMode: TextWritingMode;
    textOrientation: TextOrientation;
    tateChuYoko: boolean;
    tateChuYokoMaxLength: number;
};

export const TEXT_WRITING_MODES: readonly TextWritingMode[] = ["horizontal-tb", "vertical-rl", "vertical-lr"];
export const TEXT_ORIENTATIONS: readonly TextOrientation[] = ["mixed", "upright", "sideways"];

/** Widest run tate-chu-yoko may combine. Past four the combined glyphs are unreadably narrow. */
export const TATE_CHU_YOKO_MAX_LENGTH_LIMIT = 4;

export function isVerticalWritingMode(mode: TextWritingMode | undefined): boolean {
    return mode === "vertical-rl" || mode === "vertical-lr";
}

/**
 * Normalises the four vertical props out of whatever a stored element carries.
 *
 * Stored documents predate these props and a project file can be hand-edited, so an unknown string
 * has to resolve to the horizontal default rather than reach CSS, where `writing-mode: garbage`
 * silently leaves the box horizontal but `text-orientation: garbage` does not, and the two would
 * disagree about what the author is looking at.
 */
export function normalizeVerticalTypography(
    raw: Partial<VerticalTypographySettings> | undefined,
): VerticalTypographySettings {
    const writingMode = TEXT_WRITING_MODES.includes(raw?.writingMode as TextWritingMode)
        ? (raw!.writingMode as TextWritingMode)
        : "horizontal-tb";
    const textOrientation = TEXT_ORIENTATIONS.includes(raw?.textOrientation as TextOrientation)
        ? (raw!.textOrientation as TextOrientation)
        : "mixed";
    const rawMax = Number(raw?.tateChuYokoMaxLength);
    const tateChuYokoMaxLength = Number.isFinite(rawMax)
        ? Math.min(TATE_CHU_YOKO_MAX_LENGTH_LIMIT, Math.max(1, Math.round(rawMax)))
        : 2;
    return {
        writingMode,
        textOrientation,
        tateChuYoko: raw?.tateChuYoko !== false,
        tateChuYokoMaxLength,
    };
}

/**
 * The writing-mode half of a text box's style.
 *
 * `textOrientation` is only emitted while vertical: in a horizontal box it does nothing, and
 * writing it anyway would put a property in the inspector's way that has no effect to show.
 */
export function verticalTypographyCss(
    settings: Pick<VerticalTypographySettings, "writingMode" | "textOrientation">,
): Pick<CSSProperties, "writingMode" | "textOrientation"> {
    if (!isVerticalWritingMode(settings.writingMode)) {
        return { writingMode: "horizontal-tb" };
    }
    return {
        writingMode: settings.writingMode,
        textOrientation: settings.textOrientation,
    };
}

/**
 * Sizing for the paragraph inside the flex shell.
 *
 * Logical rather than physical: the shell is a column flex box, so in a vertical writing mode its
 * main axis is horizontal and a `width: 100%` paragraph would claim the whole box across the
 * columns' direction instead of the height of one column.
 */
export function textBodyInlineSizeCss(writingMode: TextWritingMode): CSSProperties {
    if (!isVerticalWritingMode(writingMode)) {
        return { width: "100%" };
    }
    return { height: "100%", maxHeight: "100%" };
}

/**
 * Whether a flex axis lands on the screen's horizontal axis, given the writing mode.
 *
 * Flexbox is writing-mode aware and `column` means "along the block axis", so a list that stacks
 * its items vertically stacks them *across the screen* once the writing mode is vertical. Anything
 * physical that has to follow - which overflow scrolls, which drag gesture pans - has to ask this
 * rather than read the direction on its own.
 */
export function isPhysicallyHorizontalAxis(
    axis: "vertical" | "horizontal",
    writingMode: TextWritingMode,
): boolean {
    return isVerticalWritingMode(writingMode) ? axis === "vertical" : axis === "horizontal";
}

export type VerticalTextSegment = {
    text: string;
    /** Set upright and combined into one glyph cell (縦中横). */
    combineUpright: boolean;
};

/** Latin letters, digits, and the punctuation that stays inside a run like `12.5` or `PC-98`. */
const TCY_RUN = /[0-9A-Za-z]+(?:[.:\-/][0-9A-Za-z]+)*/g;

/**
 * Splits text into the runs that tate-chu-yoko combines and the text between them.
 *
 * Only runs no longer than `maxLength` are combined; a longer Latin word stays in the surrounding
 * segment and is laid on its side by `text-orientation: mixed`, which is what a Japanese novel does
 * with an English word it cannot fit across a column.
 */
export function segmentVerticalText(text: string, maxLength: number): VerticalTextSegment[] {
    const segments: VerticalTextSegment[] = [];
    let cursor = 0;
    TCY_RUN.lastIndex = 0;
    for (let match = TCY_RUN.exec(text); match; match = TCY_RUN.exec(text)) {
        if (match[0].length > maxLength) {
            continue;
        }
        if (match.index > cursor) {
            segments.push({ text: text.slice(cursor, match.index), combineUpright: false });
        }
        segments.push({ text: match[0], combineUpright: true });
        cursor = match.index + match[0].length;
    }
    if (cursor < text.length) {
        segments.push({ text: text.slice(cursor), combineUpright: false });
    }
    return segments;
}

/**
 * Whether the text needs the split at all.
 *
 * The renderer keeps a plain text node when this is false, so the common case - horizontal text,
 * or vertical text with nothing to combine - never grows a wrapper element per run.
 */
export function needsTateChuYokoSegments(
    text: string,
    settings: VerticalTypographySettings,
): boolean {
    if (!isVerticalWritingMode(settings.writingMode) || !settings.tateChuYoko) {
        return false;
    }
    if (settings.textOrientation === "sideways") {
        return false;
    }
    return segmentVerticalText(text, settings.tateChuYokoMaxLength).some(segment => segment.combineUpright);
}
