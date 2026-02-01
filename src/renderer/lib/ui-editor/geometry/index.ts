import type { Point2D, Rect2D, ViewportTransform } from "./types";

const MIN_SCALE = 1e-4;

function isRect(value: Point2D | Rect2D): value is Rect2D {
    return "width" in value && "height" in value;
}

function clampScale(scale: number): number {
    return Math.max(MIN_SCALE, scale);
}

function mapRect(value: Rect2D, mapper: (point: Point2D) => Point2D, sizeMapper?: (size: { width: number; height: number }) => { width: number; height: number }): Rect2D {
    const point = mapper({ x: value.x, y: value.y });
    const size = sizeMapper ? sizeMapper({ width: value.width, height: value.height }) : { width: value.width, height: value.height };
    return { x: point.x, y: point.y, width: size.width, height: size.height };
}

function clientToViewportPoint(point: Point2D, containerRect: Rect2D): Point2D {
    return {
        x: point.x - containerRect.x,
        y: point.y - containerRect.y,
    };
}

function viewportToSurfacePoint(point: Point2D, transform: ViewportTransform): Point2D {
    const scale = clampScale(transform.scale);
    return {
        x: (point.x - transform.offsetX) / scale,
        y: (point.y - transform.offsetY) / scale,
    };
}

export * from "./types";

/**
 * Convert screen coordinates to viewport coordinates.
 * Screen coordinates are treated as client relative to the canvas container.
 */
export function screenToViewport(value: Point2D, containerRect: Rect2D): Point2D;
export function screenToViewport(value: Rect2D, containerRect: Rect2D): Rect2D;
export function screenToViewport(value: Point2D | Rect2D, containerRect: Rect2D): Point2D | Rect2D {
    if (isRect(value)) {
        return mapRect(value, point => clientToViewportPoint(point, containerRect));
    }
    return clientToViewportPoint(value, containerRect);
}

export function clientToViewport(value: Point2D, containerRect: Rect2D): Point2D;
export function clientToViewport(value: Rect2D, containerRect: Rect2D): Rect2D;
export function clientToViewport(value: Point2D | Rect2D, containerRect: Rect2D): Point2D | Rect2D {
    if (isRect(value)) {
        return mapRect(value, point => clientToViewportPoint(point, containerRect));
    }
    return clientToViewportPoint(value, containerRect);
}

export function viewportToSurface(value: Point2D, transform: ViewportTransform): Point2D;
export function viewportToSurface(value: Rect2D, transform: ViewportTransform): Rect2D;
export function viewportToSurface(value: Point2D | Rect2D, transform: ViewportTransform): Point2D | Rect2D {
    if (isRect(value)) {
        const sizeMapper = (size: { width: number; height: number }) => {
            const scale = clampScale(transform.scale);
            return { width: size.width / scale, height: size.height / scale };
        };
        return mapRect(value, point => viewportToSurfacePoint(point, transform), sizeMapper);
    }
    return viewportToSurfacePoint(value, transform);
}

export function clientToSurface(value: Point2D, transform: ViewportTransform, containerRect: Rect2D): Point2D;
export function clientToSurface(value: Rect2D, transform: ViewportTransform, containerRect: Rect2D): Rect2D;
export function clientToSurface(value: Point2D | Rect2D, transform: ViewportTransform, containerRect: Rect2D): Point2D | Rect2D {
    if (isRect(value)) {
        const viewportRect = clientToViewport(value, containerRect) as Rect2D;
        return viewportToSurface(viewportRect, transform);
    }
    const viewportPoint = clientToViewport(value, containerRect) as Point2D;
    return viewportToSurface(viewportPoint, transform);
}
