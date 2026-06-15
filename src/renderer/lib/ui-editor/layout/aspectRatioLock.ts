import type { UILayout } from "@shared/types/ui-editor/document";
import type { ResizeAxisResult } from "@/lib/ui-editor/interaction/utils";
import { computeUniformScaleResizeTranslate } from "@/lib/ui-editor/interaction/utils";

const EPS = 1e-6;
const MIN_SIZE = 1e-3;

/**
 * Build layout patch for width/height edits, optionally pairing dimensions when lockAspectRatio is set.
 */
export function pairLayoutDimensionsForLock(
    layout: UILayout,
    key: "width" | "height",
    nextRaw: number,
): Partial<UILayout> {
    const absW0 = Math.abs(layout.width);
    const absH0 = Math.abs(layout.height);
    const ratio = absW0 >= EPS && absH0 >= EPS ? absW0 / absH0 : 1;

    if (!layout.lockAspectRatio) {
        if (key === "width") {
            return {
                width: Math.abs(nextRaw),
                x: nextRaw < 0 ? layout.x + nextRaw : layout.x,
            };
        }
        return {
            height: Math.abs(nextRaw),
            y: nextRaw < 0 ? layout.y + nextRaw : layout.y,
        };
    }

    if (key === "width") {
        const nextW = Math.max(Math.abs(nextRaw), MIN_SIZE);
        const nextH = Math.max(nextW / ratio, MIN_SIZE);
        return {
            width: nextW,
            height: nextH,
            x: nextRaw < 0 ? layout.x + nextRaw : layout.x,
        };
    }
    const nextH = Math.max(Math.abs(nextRaw), MIN_SIZE);
    const nextW = Math.max(nextH * ratio, MIN_SIZE);
    return {
        width: nextW,
        height: nextH,
        y: nextRaw < 0 ? layout.y + nextRaw : layout.y,
    };
}

export type FreeResizePreview = {
    width: number;
    height: number;
    signedWidth: number;
    signedHeight: number;
    translateX: number;
    translateY: number;
};

/**
 * Signed axis values at resize start (delta = 0). Used so scale is 1 on the first frame even when
 * direction -1 yields signedSize = -startSize (raw sx/startW would be -1 and caused a jump).
 */
export type LockedAspectResizeInitial = {
    sx0: number;
    sy0: number;
};

/**
 * Uniform scale from free resize preview when aspect ratio is locked (single-element resize).
 */
export function applyLockedAspectToResizePreview(
    lockAspectRatio: boolean,
    layout: UILayout,
    directionX: number,
    directionY: number,
    xAxis: ResizeAxisResult,
    yAxis: ResizeAxisResult,
    cosR: number,
    sinR: number,
    free: FreeResizePreview,
    initial: LockedAspectResizeInitial,
): FreeResizePreview {
    if (!lockAspectRatio) {
        return free;
    }

    const startW = layout.width;
    const startH = layout.height;
    if (!(startW > EPS && startH > EPS)) {
        return free;
    }

    const sx = xAxis.signedSize;
    const sy = yAxis.signedSize;
    const { sx0, sy0 } = initial;

    let s: number;
    if (directionX !== 0 && directionY !== 0) {
        const dot = sx * startW + sy * startH;
        const dot0 = sx0 * startW + sy0 * startH;
        s = Math.abs(dot0) > EPS ? dot / dot0 : 1;
    } else if (directionX !== 0) {
        s = Math.abs(sx0) > EPS ? sx / sx0 : 1;
    } else if (directionY !== 0) {
        s = Math.abs(sy0) > EPS ? sy / sy0 : 1;
    } else {
        s = 1;
    }

    if (!Number.isFinite(s) || s === 0) {
        return free;
    }

    const sMin = MIN_SIZE / Math.max(startW, startH);
    if (Math.abs(s) < sMin) {
        s = Math.sign(s || 1) * sMin;
    }

    const newW = startW * s;
    const newH = startH * s;
    const absW = Math.abs(newW);
    const absH = Math.abs(newH);

    // Always anchor-based uniform translate (including s < 0) so the pivot stays the opposite
    // corner / edge center — not pointer-chasing computeResizeTranslate after flip.
    const t = computeUniformScaleResizeTranslate(
        directionX,
        directionY,
        startW,
        startH,
        newW,
        newH,
        cosR,
        sinR,
    );
    const { translateX, translateY } = t;

    return {
        width: absW,
        height: absH,
        signedWidth: newW,
        signedHeight: newH,
        translateX,
        translateY,
    };
}
