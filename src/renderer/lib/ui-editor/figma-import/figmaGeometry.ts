/**
 * The arithmetic between Figma's coordinate model and the interface document's.
 *
 * Figma places every node by an absolute affine transform whose origin is the node's top-left corner
 * and rotates about that corner. An element is placed relative to its parent and rotates about its
 * centre (CSS `rotate`). So a node is placed by its centre: the centre is carried into the parent's
 * own unrotated space, and the box is laid back around it. That is exact for any rotation and any
 * nesting, which reading Figma's `x` / `y` is not - a group's children are measured from the nearest
 * frame, not from the group.
 *
 * Comments in English per project convention.
 */

import type { GradientFill, GradientStop } from "@shared/types/ui-editor/gradientFill";
import type { FigmaGradientType, FigmaMatrix, FigmaRGBA } from "./figmaExportFormat";

export type Point = { x: number; y: number };

export const IDENTITY_MATRIX: FigmaMatrix = [[1, 0, 0], [0, 1, 0]];

export function applyMatrix(m: FigmaMatrix, x: number, y: number): Point {
    return { x: m[0][0] * x + m[0][1] * y + m[0][2], y: m[1][0] * x + m[1][1] * y + m[1][2] };
}

export function invertMatrix(m: FigmaMatrix): FigmaMatrix {
    const [[a, c, tx], [b, d, ty]] = m;
    const det = a * d - b * c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
        return IDENTITY_MATRIX;
    }
    const ia = d / det;
    const ib = -b / det;
    const ic = -c / det;
    const id = a / det;
    return [
        [ia, ic, -(ia * tx + ic * ty)],
        [ib, id, -(ib * tx + id * ty)],
    ];
}

/** The matrix's rotation in degrees, clockwise on screen - the sense CSS `rotate` takes. */
export function matrixRotationDeg(m: FigmaMatrix): number {
    return (Math.atan2(m[1][0], m[0][0]) * 180) / Math.PI;
}

/** An angle folded into (-180, 180], with values within a hair of zero snapped to it. */
export function normalizeDegrees(deg: number): number {
    let out = deg % 360;
    if (out > 180) out -= 360;
    if (out <= -180) out += 360;
    return Math.abs(out) < 1e-6 ? 0 : out;
}

export type RelativeBox = { x: number; y: number; width: number; height: number; rotation: number };

/**
 * A node's box in its parent's space: top-left, size and rotation as an element stores them, before
 * any scaling.
 */
export function placeInParent(
    node: { transform: FigmaMatrix; width: number; height: number },
    parentTransform: FigmaMatrix,
): RelativeBox {
    const centre = applyMatrix(node.transform, node.width / 2, node.height / 2);
    const local = applyMatrix(invertMatrix(parentTransform), centre.x, centre.y);
    return {
        x: local.x - node.width / 2,
        y: local.y - node.height / 2,
        width: node.width,
        height: node.height,
        rotation: normalizeDegrees(matrixRotationDeg(node.transform) - matrixRotationDeg(parentTransform)),
    };
}

/** Rounded to two decimals, which is finer than anything an author can see and keeps files short. */
export function round2(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    const out = Math.round(value * 100) / 100;
    return Object.is(out, -0) ? 0 : out;
}

function channel(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function hex2(value: number): string {
    return channel(value).toString(16).padStart(2, "0").toUpperCase();
}

/**
 * A Figma colour as a stored colour string: `#RRGGBB` when opaque, `rgba(...)` otherwise - the two
 * spellings `serializeColorValue` writes, so the inspector reads an imported colour exactly as it
 * reads one an author picked.
 */
export function figmaColorToCss(color: FigmaRGBA, opacity = 1): string {
    const alpha = Math.max(0, Math.min(1, (Number.isFinite(color.a) ? color.a : 1) * (Number.isFinite(opacity) ? opacity : 1)));
    if (alpha >= 0.999) {
        return `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
    }
    const a = Math.round(alpha * 1000) / 1000;
    return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${a})`;
}

/**
 * A Figma gradient as a gradient fill, for a box of `width` x `height`.
 *
 * Figma's `gradientTransform` maps the node's unit square onto a gradient space in which a linear
 * gradient runs from (0, 0.5) to (1, 0.5) and a radial one is centred on (0.5, 0.5) with radius 0.5.
 * Its inverse therefore gives the handles in the node's unit square. CSS draws a linear gradient
 * along a line through the box's centre whose length depends on the angle, so the stops are
 * re-measured along that line: a gradient whose handles stop short of the box's edges keeps its
 * colours where Figma drew them instead of being stretched edge to edge.
 *
 * Diamond has no CSS counterpart and is drawn as radial, which is the nearest look.
 */
export function figmaGradientToFill(
    type: FigmaGradientType,
    transform: FigmaMatrix,
    stops: readonly { position: number; color: FigmaRGBA }[],
    opacity: number,
    width: number,
    height: number,
): GradientFill {
    const inverse = invertMatrix(transform);
    const toBox = (gx: number, gy: number): Point => {
        const unit = applyMatrix(inverse, gx, gy);
        return { x: unit.x * width, y: unit.y * height };
    };
    const colorStops: GradientStop[] = stops.map(stop => ({
        offset: Math.max(0, Math.min(1, stop.position)),
        color: figmaColorToCss(stop.color, opacity),
    }));

    if (type === "GRADIENT_LINEAR") {
        const start = toBox(0, 0.5);
        const end = toBox(1, 0.5);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (length < 1e-9) {
            return { kind: "linear", angle: 180, stops: ensureTwoStops(colorStops) };
        }
        // CSS: 0deg points up, 90deg right.
        const angle = normalizeAngle360((Math.atan2(dx, -dy) * 180) / Math.PI);
        const rad = (angle * Math.PI) / 180;
        const dir = { x: Math.sin(rad), y: -Math.cos(rad) };
        const cssLength = Math.abs(width * Math.sin(rad)) + Math.abs(height * Math.cos(rad));
        const centre = { x: width / 2, y: height / 2 };
        const along = (p: Point) =>
            cssLength < 1e-9 ? 0.5 : ((p.x - centre.x) * dir.x + (p.y - centre.y) * dir.y) / cssLength + 0.5;
        const t0 = along(start);
        const t1 = along(end);
        return {
            kind: "linear",
            angle: round2(angle),
            stops: ensureTwoStops(
                colorStops.map(stop => ({ ...stop, offset: clamp01(round4(t0 + stop.offset * (t1 - t0))) })),
            ),
        };
    }

    const centreUnit = applyMatrix(inverse, 0.5, 0.5);
    const centre = { x: clamp01(round4(centreUnit.x)), y: clamp01(round4(centreUnit.y)) };
    if (type === "GRADIENT_ANGULAR") {
        const handle = toBox(1, 0.5);
        const c = toBox(0.5, 0.5);
        // Figma starts the sweep at the handle; CSS conic starts at its `from` angle, 0 = up.
        const angle = normalizeAngle360((Math.atan2(handle.x - c.x, -(handle.y - c.y)) * 180) / Math.PI);
        return { kind: "conic", angle: round2(angle), center: centre, stops: ensureTwoStops(colorStops) };
    }
    const rx = applyMatrix(inverse, 1, 0.5);
    const ry = applyMatrix(inverse, 0.5, 1);
    return {
        kind: "radial",
        center: centre,
        radius: {
            x: round4(Math.hypot(rx.x - centreUnit.x, rx.y - centreUnit.y)),
            y: round4(Math.hypot(ry.x - centreUnit.x, ry.y - centreUnit.y)),
        },
        stops: ensureTwoStops(colorStops),
    };
}

function ensureTwoStops(stops: GradientStop[]): GradientStop[] {
    const sorted = [...stops].sort((a, b) => a.offset - b.offset);
    if (sorted.length >= 2) {
        return sorted;
    }
    const only = sorted[0]?.color ?? "#000000";
    return [{ offset: 0, color: only }, { offset: 1, color: only }];
}

function normalizeAngle360(deg: number): number {
    const out = ((deg % 360) + 360) % 360;
    return Math.abs(out - 360) < 1e-6 ? 0 : out;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
    return Math.round(value * 10000) / 10000;
}
