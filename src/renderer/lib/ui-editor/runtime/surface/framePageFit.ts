import type { UISurfaceDesignSize } from "@shared/types/ui-editor/document";

/** Where a page lands in a box it is fitted into, in the box's own units. */
export type FramePageFit = {
    /** What the page's design size is multiplied by. */
    scale: number;
    left: number;
    top: number;
    /** The page's design size times {@link scale}. */
    width: number;
    height: number;
};

/**
 * How a Page widget fits a page into a box: scaled to cover it with the page's proportions kept,
 * and centred.
 *
 * Covering rather than letterboxing because a frame normally keeps its page's proportions, and one
 * that has drifted from them by a fraction of a pixel - an old document, a hand-typed size - would
 * otherwise show a hairline of the frame's background down one edge. A page whose proportions really
 * are different loses the same amount off both sides.
 *
 * One rule for both places a page is fitted: the frame's widget fitting the box its pages are drawn
 * in to the frame (see `FrameRenderer`), and a page of another design size fitted into that box
 * while the frame changes page. Because they agree, a page drawn in a box sized for a page of the
 * same proportions lands exactly where it sits when it is the frame's page.
 */
export function fitFramePage(page: UISurfaceDesignSize, box: UISurfaceDesignSize): FramePageFit {
    const scale = Math.max(box.width / page.width, box.height / page.height);
    const width = page.width * scale;
    const height = page.height * scale;
    return {
        scale,
        left: (box.width - width) / 2,
        top: (box.height - height) / 2,
        width,
        height,
    };
}
