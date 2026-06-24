const WHEEL_DELTA_MODE_PIXEL = 0;
const WHEEL_DELTA_MODE_LINE = 1;
const WHEEL_DELTA_MODE_PAGE = 2;

const WHEEL_LINE_DELTA_PX = 16;
const DEFAULT_WHEEL_PAGE_DELTA_PX = 800;

export const SURFACE_WHEEL_ZOOM_DELTA_LIMIT_PX = 80;
export const SURFACE_PINCH_ZOOM_DELTA_LIMIT_PX = 24;
export const SURFACE_WHEEL_PAN_DELTA_LIMIT_PX = 96;

export function resolveSurfaceWheelPageDelta(sizePx: number): number {
    return Number.isFinite(sizePx) && sizePx > 0 ? sizePx : DEFAULT_WHEEL_PAGE_DELTA_PX;
}

export function normalizeSurfaceWheelDelta(delta: number, deltaMode: number, pageDeltaPx: number): number {
    if (!Number.isFinite(delta)) {
        return 0;
    }

    if (deltaMode === WHEEL_DELTA_MODE_LINE) {
        return delta * WHEEL_LINE_DELTA_PX;
    }

    if (deltaMode === WHEEL_DELTA_MODE_PAGE) {
        return delta * resolveSurfaceWheelPageDelta(pageDeltaPx);
    }

    return delta;
}

export function clampSurfaceWheelDelta(delta: number, maxAbsDelta: number): number {
    if (!Number.isFinite(delta)) {
        return 0;
    }

    const limit = Math.max(0, maxAbsDelta);
    if (Math.abs(delta) <= limit) {
        return delta;
    }

    return Math.sign(delta) * limit;
}
