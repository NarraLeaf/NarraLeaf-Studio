import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Layout rounds to fractional pixels, so a line that fills its box exactly must still count as fitting. */
const FIT_TOLERANCE_PX = 0.5;

/** Stop bisecting once the remaining window is finer than the eye can tell. */
const SEARCH_PRECISION_PX = 0.25;

/** Guards against a pathological range; the window halves every step, so this is never reached in practice. */
const MAX_SEARCH_STEPS = 12;

export type AutoFitInput = {
    enabled: boolean;
    /** The authored size, which auto fit treats as a ceiling. */
    fontSize: number;
    /** The floor. A line that overflows at this size is clipped rather than set smaller. */
    minFontSize: number;
    /** Vertical writing swaps the two axes: columns advance across the box, lines run down it. */
    vertical: boolean;
    /**
     * Everything that changes the laid-out result without changing the box: the text itself, the
     * typeface, the weight, the wrap mode. Measurement re-runs when this changes.
     */
    signature: string;
};

export type AutoFitResult<TBox extends HTMLElement, TText extends HTMLElement> = {
    /** The element whose content box the text has to fit. */
    boxRef: (node: TBox | null) => void;
    /** The element that carries the glyphs. */
    textRef: (node: TText | null) => void;
    /** The size to render at: the authored one until a measurement says otherwise. */
    fontSize: number;
};

function clampFloor(floor: number, ceiling: number): number {
    if (!Number.isFinite(floor) || floor <= 0) {
        return ceiling;
    }
    return Math.min(floor, ceiling);
}

/**
 * The largest size in `[floor, ceiling]` that `fits`, to within a quarter of a pixel.
 *
 * The floor is the answer when nothing in the range fits: a line that overflows even at the
 * smallest size the author allowed is left overflowing rather than set smaller than they asked.
 */
export function findLargestFittingSize(floor: number, ceiling: number, fits: (size: number) => boolean): number {
    if (fits(ceiling)) {
        return ceiling;
    }
    if (floor >= ceiling || !fits(floor)) {
        return floor;
    }
    let low = floor;
    let high = ceiling;
    for (let step = 0; step < MAX_SEARCH_STEPS && high - low > SEARCH_PRECISION_PX; step++) {
        const middle = (low + high) / 2;
        if (fits(middle)) {
            low = middle;
        } else {
            high = middle;
        }
    }
    return low;
}

/**
 * Sizes a text element down until it fits the box it is placed in.
 *
 * The search is a bisection over the inline font size, run against the live element rather than a
 * measured copy: the element already holds the whole string, so setting a candidate size and
 * reading the resulting scroll size answers "does this fit" exactly, including wrapping, ruby and
 * vertical columns. Reading layout in a layout effect keeps the intermediate sizes off screen.
 */
export function useAutoFitFontSize<TBox extends HTMLElement, TText extends HTMLElement>({
    enabled,
    fontSize,
    minFontSize,
    vertical,
    signature,
}: AutoFitInput): AutoFitResult<TBox, TText> {
    const boxNodeRef = useRef<TBox | null>(null);
    const textNodeRef = useRef<TText | null>(null);
    const [fitted, setFitted] = useState<number | null>(null);
    const [boxNode, setBoxNode] = useState<TBox | null>(null);
    const measuredBoxRef = useRef(0);

    const boxRef = useCallback((node: TBox | null) => {
        boxNodeRef.current = node;
        setBoxNode(node);
    }, []);
    const textRef = useCallback((node: TText | null) => {
        textNodeRef.current = node;
    }, []);

    const measure = useCallback(() => {
        const box = boxNodeRef.current;
        const text = textNodeRef.current;
        if (!box || !text) {
            return;
        }
        const availableBlock = vertical ? box.clientWidth : box.clientHeight;
        const availableInline = vertical ? box.clientHeight : box.clientWidth;
        if (availableBlock <= 0 || availableInline <= 0) {
            return;
        }
        measuredBoxRef.current = availableBlock;
        const ceiling = fontSize;
        const floor = clampFloor(minFontSize, ceiling);
        const restore = text.style.fontSize;
        const fitsAt = (candidate: number): boolean => {
            text.style.fontSize = `${candidate}px`;
            const block = vertical ? text.scrollWidth : text.scrollHeight;
            const inline = vertical ? text.scrollHeight : text.scrollWidth;
            return block <= availableBlock + FIT_TOLERANCE_PX && inline <= availableInline + FIT_TOLERANCE_PX;
        };

        const result = findLargestFittingSize(floor, ceiling, fitsAt);

        text.style.fontSize = restore;
        setFitted(previous => (previous !== null && Math.abs(previous - result) < 0.01 ? previous : result));
    }, [fontSize, minFontSize, vertical]);

    useLayoutEffect(() => {
        if (!enabled) {
            setFitted(null);
            return undefined;
        }
        measure();
        if (!boxNode) {
            return undefined;
        }
        // Only a box that actually changed size asks for a new answer: the fitted text changes the
        // box's own content size, and re-measuring on that would chase itself.
        const observer =
            typeof ResizeObserver === "undefined"
                ? null
                : new ResizeObserver(() => {
                      const current = vertical ? boxNode.clientWidth : boxNode.clientHeight;
                      if (Math.abs(current - measuredBoxRef.current) > FIT_TOLERANCE_PX) {
                          measure();
                      }
                  });
        observer?.observe(boxNode);
        // A webfont that arrives after the first paint re-lays the line out under the same box.
        let cancelled = false;
        void document.fonts?.ready.then(() => {
            if (!cancelled) {
                measure();
            }
        });
        return () => {
            cancelled = true;
            observer?.disconnect();
        };
    }, [boxNode, enabled, measure, signature, vertical]);

    return {
        boxRef,
        textRef,
        fontSize: enabled && fitted !== null ? fitted : fontSize,
    };
}
