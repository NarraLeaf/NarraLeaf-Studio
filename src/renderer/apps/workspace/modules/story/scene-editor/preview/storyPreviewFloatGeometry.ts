import {
    STORY_PREVIEW_FLOAT_DEFAULT_HEIGHT,
    STORY_PREVIEW_FLOAT_DEFAULT_WIDTH,
    STORY_PREVIEW_FLOAT_MIN_HEIGHT,
    STORY_PREVIEW_FLOAT_MIN_WIDTH,
    type StoryScenePreviewFloatRect,
} from "./storyScenePreviewSessionStore";

/**
 * The geometry of the floating live preview, as pure functions over rects.
 *
 * Every rect here is in the coordinates of the area the window floats over - the workspace's content
 * area, between the title bar and the status bar - with the origin at that area's top-left corner.
 */

/** The size of the area the window may occupy. */
export type StoryPreviewFloatBounds = { width: number; height: number };

/** Which corner of the window a resize drag holds; the opposite corner stays put. */
export type StoryPreviewFloatCorner = "nw" | "ne" | "sw" | "se";

/** Gap kept between an auto-placed window and the edge of what it is anchored to. */
export const STORY_PREVIEW_FLOAT_MARGIN = 24;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Fit a rect inside the area while respecting the minimum window size.
 *
 * An area smaller than the minimum window keeps the minimum and parks the window at the origin -
 * the area's own `overflow: hidden` crops it, which is the only honest thing to do with a window
 * that cannot fit.
 */
export function clampStoryPreviewFloatRect(rect: StoryScenePreviewFloatRect, bounds: StoryPreviewFloatBounds): StoryScenePreviewFloatRect {
    const width = clamp(rect.width, STORY_PREVIEW_FLOAT_MIN_WIDTH, Math.max(STORY_PREVIEW_FLOAT_MIN_WIDTH, bounds.width));
    const height = clamp(rect.height, STORY_PREVIEW_FLOAT_MIN_HEIGHT, Math.max(STORY_PREVIEW_FLOAT_MIN_HEIGHT, bounds.height));
    return {
        width,
        height,
        x: clamp(rect.x, 0, Math.max(0, bounds.width - width)),
        y: clamp(rect.y, 0, Math.max(0, bounds.height - height)),
    };
}

/** Drag the whole window by a pointer delta, without leaving the area. */
export function moveStoryPreviewFloatRect(
    start: StoryScenePreviewFloatRect,
    dx: number,
    dy: number,
    bounds: StoryPreviewFloatBounds,
): StoryScenePreviewFloatRect {
    return {
        ...start,
        x: clamp(start.x + dx, 0, Math.max(0, bounds.width - start.width)),
        y: clamp(start.y + dy, 0, Math.max(0, bounds.height - start.height)),
    };
}

/** Resize by dragging a corner: the two adjacent edges follow the pointer, the opposite corner stays put. */
export function resizeStoryPreviewFloatRect(
    start: StoryScenePreviewFloatRect,
    corner: StoryPreviewFloatCorner,
    dx: number,
    dy: number,
    bounds: StoryPreviewFloatBounds,
): StoryScenePreviewFloatRect {
    const right = start.x + start.width;
    const bottom = start.y + start.height;
    let { x, y, width, height } = start;

    if (corner === "nw" || corner === "sw") {
        const newX = clamp(start.x + dx, 0, right - STORY_PREVIEW_FLOAT_MIN_WIDTH);
        x = newX;
        width = right - newX;
    } else {
        const newRight = clamp(right + dx, start.x + STORY_PREVIEW_FLOAT_MIN_WIDTH, bounds.width);
        width = newRight - start.x;
    }

    if (corner === "nw" || corner === "ne") {
        const newY = clamp(start.y + dy, 0, bottom - STORY_PREVIEW_FLOAT_MIN_HEIGHT);
        y = newY;
        height = bottom - newY;
    } else {
        const newBottom = clamp(bottom + dy, start.y + STORY_PREVIEW_FLOAT_MIN_HEIGHT, bounds.height);
        height = newBottom - start.y;
    }

    return { x, y, width, height };
}

/**
 * Where a window opens the first time the preview is popped out: the bottom-right corner of the
 * scene editor it came from, so it appears over the rows it is previewing rather than across the
 * room. Without an editor to anchor to, the bottom-right corner of the whole area.
 *
 * `top-right` is for an editor whose own subject sits low - the UI editor showing a dialogue box -
 * where the bottom corner would cover what the window is there to preview.
 */
export function createDefaultStoryPreviewFloatRect(
    bounds: StoryPreviewFloatBounds | null,
    anchor: StoryScenePreviewFloatRect | null = null,
    corner: "bottom-right" | "top-right" = "bottom-right",
): StoryScenePreviewFloatRect {
    const width = STORY_PREVIEW_FLOAT_DEFAULT_WIDTH;
    const height = STORY_PREVIEW_FLOAT_DEFAULT_HEIGHT;
    const frame = anchor && anchor.width >= 1 && anchor.height >= 1
        ? anchor
        : bounds && bounds.width >= 1 && bounds.height >= 1
            ? { x: 0, y: 0, width: bounds.width, height: bounds.height }
            : null;
    if (!frame) {
        return { x: STORY_PREVIEW_FLOAT_MARGIN, y: STORY_PREVIEW_FLOAT_MARGIN, width, height };
    }
    const w = Math.min(width, frame.width);
    const h = Math.min(height, frame.height);
    const placed = {
        x: Math.max(frame.x, frame.x + frame.width - w - STORY_PREVIEW_FLOAT_MARGIN),
        y: corner === "top-right"
            ? frame.y + Math.min(STORY_PREVIEW_FLOAT_MARGIN, Math.max(0, frame.height - h))
            : Math.max(frame.y, frame.y + frame.height - h - STORY_PREVIEW_FLOAT_MARGIN),
        width: w,
        height: h,
    };
    return bounds ? clampStoryPreviewFloatRect(placed, bounds) : placed;
}

/**
 * The part of a scene editor a window may open over: the editor, short of its rows' action column.
 *
 * Each row ends in its own controls - insert, delete, ▶ play from here - and a window opened against
 * the editor's bottom-right corner sat on exactly those of the bottom rows. `actionsInset` is how far
 * the column reaches in from the right edge of the rows; the frame ends that far in from the editor's
 * own right edge, so the window opens beside the controls rather than over them. An inset of nothing,
 * or of the whole editor, leaves the editor as it is.
 *
 * An inset rather than a position because it is measured while the docked preview may still stand
 * beside the rows: the column is then further left than it will be once the preview has left the
 * editor for its window, while its distance from the rows' right edge is the same either way.
 */
export function insetStoryPreviewFloatAnchor(
    editor: StoryScenePreviewFloatRect | null,
    actionsInset: number | null,
): StoryScenePreviewFloatRect | null {
    if (!editor || actionsInset === null || actionsInset <= 0 || actionsInset >= editor.width) {
        return editor;
    }
    return { ...editor, width: Math.floor(editor.width - actionsInset) };
}

/** Each row's trailing cluster of controls (`StorySceneEditorRows`), the one holding its ▶. */
const STORY_ROW_ACTIONS_SELECTOR = ".nl-story-row-actions";

/**
 * Where a window opens over this scene editor, in the area's coordinates: the editor body as
 * {@link readRectInArea} measures it, short of its rows' action column (see
 * {@link insetStoryPreviewFloatAnchor}). The inset is the widest of the rows' trailing clusters laid
 * out at the moment, measured from the right edge of the column of rows that holds it - the body's
 * child the cluster sits in, beside which the docked preview may stand.
 */
export function readStoryPreviewFloatAnchor(editorBody: Element | null, area: Element | null): StoryScenePreviewFloatRect | null {
    const editor = readRectInArea(editorBody, area);
    if (!editor || !editorBody) {
        return editor;
    }
    let inset: number | null = null;
    editorBody.querySelectorAll(STORY_ROW_ACTIONS_SELECTOR).forEach(cluster => {
        let column: Element | null = cluster;
        while (column && column.parentElement !== editorBody) {
            column = column.parentElement;
        }
        const box = cluster.getBoundingClientRect();
        if (!column || box.width < 1 || box.height < 1) {
            return;
        }
        const reach = column.getBoundingClientRect().right - box.left;
        inset = inset === null ? reach : Math.max(inset, reach);
    });
    return insetStoryPreviewFloatAnchor(editor, inset);
}

/**
 * Carry a rect saved by a build that measured the window against the scene editor's body over to the
 * workspace's area.
 *
 * Those builds kept the window inside the editor, so its rect is an offset from the editor body's
 * top-left corner. When that body is on screen its offset inside the area is known, and adding it
 * puts the window back exactly where the author left it. When it is not, the rect is read as it
 * stands: still a size the author chose, and the clamp keeps it on screen.
 */
export function migrateEditorBodyStoryPreviewFloatRect(
    rect: StoryScenePreviewFloatRect,
    editorBodyOffset: { x: number; y: number } | null,
): StoryScenePreviewFloatRect {
    if (!editorBodyOffset) {
        return rect;
    }
    return { ...rect, x: rect.x + editorBodyOffset.x, y: rect.y + editorBodyOffset.y };
}

/**
 * An element's box in the area's coordinates, or null while either is not laid out (a hidden tab
 * reports a zero-size box).
 */
export function readRectInArea(element: Element | null, area: Element | null): StoryScenePreviewFloatRect | null {
    if (!element || !area) {
        return null;
    }
    const box = element.getBoundingClientRect();
    const origin = area.getBoundingClientRect();
    if (box.width < 1 || box.height < 1 || origin.width < 1 || origin.height < 1) {
        return null;
    }
    return {
        x: Math.round(box.left - origin.left),
        y: Math.round(box.top - origin.top),
        width: Math.floor(box.width),
        height: Math.floor(box.height),
    };
}
