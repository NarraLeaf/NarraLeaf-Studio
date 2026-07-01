const MIN_ASPECT_RATIO_SOURCE_SIZE = 0.0001;

export type SurfacePoint = {
    x: number;
    y: number;
};

export function resolveAspectRatio(width: number | null | undefined, height: number | null | undefined): number | null {
    const w = Math.abs(Number(width));
    const h = Math.abs(Number(height));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= MIN_ASPECT_RATIO_SOURCE_SIZE || h <= MIN_ASPECT_RATIO_SOURCE_SIZE) {
        return null;
    }
    return w / h;
}

export function constrainPointToAspectRatio(start: SurfacePoint, current: SurfacePoint, aspectRatio: number | null): SurfacePoint {
    if (!aspectRatio || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
        return current;
    }

    const dx = current.x - start.x;
    const dy = current.y - start.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (absDx === 0 && absDy === 0) {
        return current;
    }

    const signX = dx < 0 ? -1 : 1;
    const signY = dy < 0 ? -1 : 1;
    if (absDx / aspectRatio >= absDy) {
        return {
            x: current.x,
            y: start.y + signY * (absDx / aspectRatio),
        };
    }

    return {
        x: start.x + signX * (absDy * aspectRatio),
        y: current.y,
    };
}
