import type { OnResize } from "react-moveable";
import { ViewportTransform } from "../geometry";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UILayout } from "@shared/types/ui-editor/document";

const GEOMETRY_EPS = 1e-6;

export function isHTMLElement(node: Element | null): node is HTMLElement {
    return node instanceof HTMLElement;
}

export function buildTransform(translateX: number, translateY: number, rotation?: number) {
    const hasTranslate = translateX !== 0 || translateY !== 0;
    const hasRotation = Boolean(rotation);
    if (!hasTranslate && !hasRotation) {
        return "";
    }
    const transformParts = [];
    if (hasTranslate) {
        transformParts.push(`translate(${translateX}px, ${translateY}px)`);
    }
    if (rotation) {
        transformParts.push(`rotate(${rotation}deg)`);
    }
    return transformParts.join(" ");
}

export function applyFinalTransform(target: HTMLElement | SVGElement, rotation?: number) {
    target.style.transform = buildTransform(0, 0, rotation);
}

export function normalizeLayout(layout: UILayout) {
    let nextX = layout.x;
    let nextY = layout.y;
    let nextWidth = layout.width;
    let nextHeight = layout.height;
    if (nextWidth < 0) {
        nextX += nextWidth;
        nextWidth = Math.abs(nextWidth);
    }
    if (nextHeight < 0) {
        nextY += nextHeight;
        nextHeight = Math.abs(nextHeight);
    }
    return {
        ...layout,
        x: nextX,
        y: nextY,
        width: nextWidth,
        height: nextHeight,
    };
}

export function ensureNormalizedLayout(elementId: string, layout: UILayout, documentService: UIDocumentService) {
    if (layout.width >= 0 && layout.height >= 0) {
        return layout;
    }
    const normalized = normalizeLayout(layout);
    documentService.updateElementLayout(elementId, {
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
    });
    return normalized;
}

export type ResizeAxisResult = {
    size: number;
    signedSize: number;
    localTranslate: number;
};

/** One axis of resize math; delta is pointer movement in layout-local space along that dimension. */
export function computeResizeAxis1D(direction: number, startSize: number, delta: number): ResizeAxisResult {
    if (direction === 0) {
        return {
            size: startSize,
            signedSize: startSize,
            localTranslate: 0,
        };
    }
    const anchor = direction === 1 ? 0 : startSize;
    const pointer = direction === 1 ? startSize + delta : delta;
    const size = Math.abs(pointer - anchor);
    const localTranslate = Math.min(pointer, anchor);
    const signedSize = pointer - anchor;
    return {
        size,
        signedSize,
        localTranslate,
    };
}

/**
 * Pointer delta in layout-local space and per-axis resize components (shared with aspect-ratio lock).
 */
export function computeResizeAxes(
    e: OnResize,
    start: { clientX: number; clientY: number; layout: UILayout; direction: number[] },
    viewportScale: number,
): {
    directionX: number;
    directionY: number;
    xAxis: ResizeAxisResult;
    yAxis: ResizeAxisResult;
    layout: UILayout;
    cosR: number;
    sinR: number;
} {
    const safeScale = Math.max(viewportScale, 0.0001);
    const rawDx = (e.clientX - start.clientX) / safeScale;
    const rawDy = (e.clientY - start.clientY) / safeScale;
    const [directionX, directionY] = start.direction ?? [0, 0];

    const rotDeg = start.layout.rotation ?? 0;
    const rad = (rotDeg * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    const dx = rawDx * cosR + rawDy * sinR;
    const dy = -rawDx * sinR + rawDy * cosR;

    const xAxis = computeResizeAxis1D(directionX, start.layout.width, dx);
    const yAxis = computeResizeAxis1D(directionY, start.layout.height, dy);

    return { directionX, directionY, xAxis, yAxis, layout: start.layout, cosR, sinR };
}

/** newWidth/newHeight are positive box sizes (same as axis .size), matching Moveable preview geometry. */
export function computeResizeTranslate(
    layout: UILayout,
    xAxis: ResizeAxisResult,
    yAxis: ResizeAxisResult,
    newWidth: number,
    newHeight: number,
    cosR: number,
    sinR: number,
) {
    const startW = layout.width;
    const startH = layout.height;
    const deltaW = newWidth - startW;
    const deltaH = newHeight - startH;
    const px = xAxis.localTranslate + deltaW / 2;
    const py = yAxis.localTranslate + deltaH / 2;
    const translateX = -deltaW / 2 + px * cosR - py * sinR;
    const translateY = -deltaH / 2 + px * sinR + py * cosR;
    return { translateX, translateY };
}

/**
 * Translation so the resize anchor (opposite corner / edge center from Moveable direction) stays fixed
 * under uniform scale. For flipped boxes (`newW/newH < 0`), compute the min corner of the scaled local
 * interval so the bounding box still pivots around the original anchor instead of chasing the pointer.
 */
export function computeUniformScaleResizeTranslate(
    directionX: number,
    directionY: number,
    startW: number,
    startH: number,
    newW: number,
    newH: number,
    cosR: number,
    sinR: number,
): { translateX: number; translateY: number } {
    const sW = startW > GEOMETRY_EPS ? newW / startW : 1;
    const sH = startH > GEOMETRY_EPS ? newH / startH : 1;

    const fixX = directionX === 1 ? 0 : directionX === -1 ? startW : startW / 2;
    const fixY = directionY === 1 ? 0 : directionY === -1 ? startH : startH / 2;

    const localOriginX = fixX * (1 - sW);
    const localOriginY = fixY * (1 - sH);
    const dlx = Math.min(localOriginX, localOriginX + newW);
    const dly = Math.min(localOriginY, localOriginY + newH);

    const translateX = dlx * cosR - dly * sinR;
    const translateY = dlx * sinR + dly * cosR;

    return { translateX, translateY };
}

export function computeResizePreview(
    e: OnResize,
    start: { clientX: number; clientY: number; layout: UILayout; direction: number[] },
    viewportScale: number,
) {
    const { xAxis, yAxis, layout, cosR, sinR } = computeResizeAxes(e, start, viewportScale);
    const { translateX, translateY } = computeResizeTranslate(layout, xAxis, yAxis, xAxis.size, yAxis.size, cosR, sinR);

    return {
        width: xAxis.size,
        height: yAxis.size,
        signedWidth: xAxis.signedSize,
        signedHeight: yAxis.signedSize,
        translateX,
        translateY,
    };
}
