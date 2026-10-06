import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { computeGridScreenLines, type GridScreenLines, type UIEditorGridStyle } from "@/lib/ui-editor/snapping/gridSnap";

type Props = {
    designSize: { width: number; height: number };
    /** Grid spacing in design pixels. */
    spacing: number;
    /** Full lines, or a dot at each grid point. */
    style: UIEditorGridStyle;
    viewport: { scale: number; offsetX: number; offsetY: number };
};

/** Where the overlay sits in device pixels, which is what a line or a dot has to be aligned to. */
export type OverlayFrame = {
    width: number;
    height: number;
    dpr: number;
    /** The overlay's left and top edges in device pixels. */
    deviceLeft: number;
    deviceTop: number;
};

/** A dot's side in CSS pixels, before it is rounded to whole device pixels. */
const GRID_DOT_CSS_PX = 1.5;

/**
 * Moves a line at overlay coordinate `css` onto the centre of the device pixel it falls in, so a
 * one-device-pixel stroke covers exactly one row or column instead of smearing across two.
 */
function alignToDevicePixel(css: number, deviceOrigin: number, dpr: number): number {
    const device = Math.floor(deviceOrigin + css * dpr) + 0.5;
    return (device - deviceOrigin) / dpr;
}

function sameFrame(a: OverlayFrame | null, b: OverlayFrame): boolean {
    return (
        a != null &&
        a.width === b.width &&
        a.height === b.height &&
        a.dpr === b.dpr &&
        a.deviceLeft === b.deviceLeft &&
        a.deviceTop === b.deviceTop
    );
}

/** The dots in canvas pixels, and where the canvas goes so that its pixels are the screen's. */
export type GridDotLayout = {
    /** The canvas's place in the overlay, in CSS pixels; its top-left lands on a device pixel's corner. */
    css: { left: number; top: number; width: number; height: number };
    /** The canvas's backing size in device pixels. */
    pixelWidth: number;
    pixelHeight: number;
    /** A dot's side in device pixels. */
    size: number;
    /** Each dot column's left and each dot row's top, in canvas pixels. */
    xs: number[];
    ys: number[];
};

/**
 * Lays the dots out on whole device pixels. The canvas covers the overlay, shifted by less than one
 * device pixel so that its pixel grid is the screen's; each dot is centred on the device pixel the
 * matching line would be drawn in, so every dot is the same crisp square at any zoom.
 */
export function layoutGridDots(lines: GridScreenLines, frame: OverlayFrame): GridDotLayout {
    const { dpr, deviceLeft, deviceTop } = frame;
    const originX = Math.floor(deviceLeft);
    const originY = Math.floor(deviceTop);
    const pixelWidth = Math.max(0, Math.ceil(deviceLeft + frame.width * dpr) - originX);
    const pixelHeight = Math.max(0, Math.ceil(deviceTop + frame.height * dpr) - originY);
    const size = Math.max(1, Math.round(GRID_DOT_CSS_PX * dpr));
    // An even-sized dot cannot be centred on one pixel; it leans right and down by half a pixel.
    const lead = Math.floor((size - 1) / 2);
    const place = (css: number, deviceOrigin: number, origin: number) =>
        Math.floor(deviceOrigin + css * dpr) - origin - lead;
    return {
        css: {
            left: (originX - deviceLeft) / dpr,
            top: (originY - deviceTop) / dpr,
            width: pixelWidth / dpr,
            height: pixelHeight / dpr,
        },
        pixelWidth,
        pixelHeight,
        size,
        xs: lines.xs.map(x => place(x, deviceLeft, originX)),
        ys: lines.ys.map(y => place(y, deviceTop, originY)),
    };
}

function GridLines({ lines, frame }: { lines: GridScreenLines; frame: OverlayFrame }) {
    const path = useMemo(() => {
        const { box } = lines;
        const parts: string[] = [];
        for (const x of lines.xs) {
            const ax = alignToDevicePixel(x, frame.deviceLeft, frame.dpr);
            parts.push(`M${ax.toFixed(3)} ${box.top.toFixed(3)}V${box.bottom.toFixed(3)}`);
        }
        for (const y of lines.ys) {
            const ay = alignToDevicePixel(y, frame.deviceTop, frame.dpr);
            parts.push(`M${box.left.toFixed(3)} ${ay.toFixed(3)}H${box.right.toFixed(3)}`);
        }
        return parts.join("");
    }, [frame, lines]);

    return (
        <svg
            className="absolute left-0 top-0 text-fg-muted/30"
            width={frame.width}
            height={frame.height}
            viewBox={`0 0 ${frame.width} ${frame.height}`}
            aria-hidden="true"
        >
            <path d={path} fill="none" stroke="currentColor" strokeWidth={1 / frame.dpr} />
        </svg>
    );
}

/**
 * The dots go on a canvas rather than into an SVG path: a zoomed-out page puts tens of thousands of
 * them in view, and they are redrawn on every frame of a pan or zoom.
 */
function GridDots({ lines, frame }: { lines: GridScreenLines; frame: OverlayFrame }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const layout = useMemo(() => layoutGridDots(lines, frame), [frame, lines]);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        if (canvas.width !== layout.pixelWidth || canvas.height !== layout.pixelHeight) {
            canvas.width = layout.pixelWidth;
            canvas.height = layout.pixelHeight;
        }
        const context = canvas.getContext("2d");
        if (!context) {
            return;
        }
        context.clearRect(0, 0, canvas.width, canvas.height);
        // The colour comes from the canvas's own text colour class, read at draw time, so a theme
        // switch shows on the next repaint.
        context.fillStyle = getComputedStyle(canvas).color;
        context.beginPath();
        for (const y of layout.ys) {
            for (const x of layout.xs) {
                context.rect(x, y, layout.size, layout.size);
            }
        }
        context.fill();
    }, [layout]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute text-fg-muted/60"
            style={{ left: layout.css.left, top: layout.css.top, width: layout.css.width, height: layout.css.height }}
            aria-hidden="true"
        />
    );
}

/**
 * The canvas grid, drawn while grid snapping is on.
 *
 * Drawn in the viewport's own pixels rather than inside the zoomed canvas, so a line is one device
 * pixel wide, and a dot the same few device pixels, at every zoom instead of being scaled (and
 * blurred) with the page. It covers the page only - the grid starts at the page's top-left corner,
 * the same origin the snapping uses - and it thins out when the cells get small on screen
 * (`resolveGridDisplayStep`), so a zoomed-out page shows every second or fifth line rather than
 * turning grey. Sits above the page's content, under the selection frame and the guides, and never
 * takes the pointer.
 */
export const SurfaceGridOverlay = memo(function SurfaceGridOverlay({ designSize, spacing, style, viewport }: Props) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const [frame, setFrame] = useState<OverlayFrame | null>(null);

    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return undefined;
        }
        const measure = () => {
            const rect = host.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const next: OverlayFrame = {
                width: rect.width,
                height: rect.height,
                dpr,
                deviceLeft: rect.left * dpr,
                deviceTop: rect.top * dpr,
            };
            setFrame(previous => (sameFrame(previous, next) ? previous : next));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(host);
        window.addEventListener("resize", measure);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, []);

    const lines = useMemo(() => {
        if (!frame) {
            return null;
        }
        return computeGridScreenLines({
            spacing,
            viewport,
            designSize,
            overlaySize: { width: frame.width, height: frame.height },
        });
    }, [designSize, frame, spacing, viewport]);

    return (
        <div
            ref={hostRef}
            className="pointer-events-none absolute inset-0 overflow-hidden"
            data-surface-grid-overlay={style}
        >
            {frame && lines ? (
                style === "dots" ? <GridDots lines={lines} frame={frame} /> : <GridLines lines={lines} frame={frame} />
            ) : null}
        </div>
    );
});
