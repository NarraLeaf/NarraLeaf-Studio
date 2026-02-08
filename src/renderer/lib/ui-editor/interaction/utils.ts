import type { OnResize } from "react-moveable";
import { ViewportTransform } from "../geometry";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UILayout } from "@shared/types/ui-editor/document";

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

export function computeResizePreview(
    e: OnResize,
    start: { clientX: number; clientY: number; layout: UILayout; direction: number[] },
    viewportScale: number,
) {
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

    const computeAxis = (direction: number, startSize: number, delta: number) => {
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
    };

    const xAxis = computeAxis(directionX, start.layout.width, dx);
    const yAxis = computeAxis(directionY, start.layout.height, dy);

    const deltaW = xAxis.size - start.layout.width;
    const deltaH = yAxis.size - start.layout.height;
    const px = xAxis.localTranslate + deltaW / 2;
    const py = yAxis.localTranslate + deltaH / 2;
    const translateX = -deltaW / 2 + px * cosR - py * sinR;
    const translateY = -deltaH / 2 + px * sinR + py * cosR;

    return {
        width: xAxis.size,
        height: yAxis.size,
        signedWidth: xAxis.signedSize,
        signedHeight: yAxis.signedSize,
        translateX,
        translateY,
    };
}
