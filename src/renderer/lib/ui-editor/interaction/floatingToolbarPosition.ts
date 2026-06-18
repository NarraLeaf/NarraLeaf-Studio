export type FloatingToolbarPosition = {
    left: number;
    top: number;
};

const DEFAULT_FLOATING_TOOLBAR_TOP_GAP = 8;
const DEFAULT_FLOATING_TOOLBAR_MIN_TOP = 34;

type RectLike = Pick<DOMRect, "left" | "top">;

export function resolveFloatingToolbarPosition(input: {
    targetRect: RectLike;
    surfaceRect: RectLike;
    gap?: number;
    minTop?: number;
}): FloatingToolbarPosition {
    const gap = input.gap ?? DEFAULT_FLOATING_TOOLBAR_TOP_GAP;
    const minTop = input.minTop ?? DEFAULT_FLOATING_TOOLBAR_MIN_TOP;
    return {
        left: input.targetRect.left - input.surfaceRect.left,
        top: Math.max(minTop, input.targetRect.top - input.surfaceRect.top - gap),
    };
}
