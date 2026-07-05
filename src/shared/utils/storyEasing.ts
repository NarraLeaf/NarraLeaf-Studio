export type StoryEasingValue = string | [number, number, number, number];

const CUBIC_BEZIER_PATTERN = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/i;

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
    return points as [number, number, number, number];
}

export function formatStoryBezierEasing(points: readonly number[]): string {
    return `cubic-bezier(${points.map(point => roundBezierPoint(point)).join(", ")})`;
}

function roundBezierPoint(value: number): number {
    return Math.round(value * 100) / 100;
}
