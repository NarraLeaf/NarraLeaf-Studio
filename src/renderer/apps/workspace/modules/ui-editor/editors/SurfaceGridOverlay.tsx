import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { computeGridScreenLines } from "@/lib/ui-editor/snapping/gridSnap";

type Props = {
    designSize: { width: number; height: number };
    /** Grid spacing in design pixels. */
    spacing: number;
    viewport: { scale: number; offsetX: number; offsetY: number };
};

/** Where the overlay sits in device pixels, which is what a line has to be aligned to. */
type OverlayFrame = {
    width: number;
    height: number;
    dpr: number;
    /** The overlay's left and top edges in device pixels. */
    deviceLeft: number;
    deviceTop: number;
};

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

/**
 * The canvas grid, drawn while grid snapping is on.
 *
 * Drawn in the viewport's own pixels rather than inside the zoomed canvas, so a line is one device
 * pixel wide at every zoom instead of being scaled (and blurred) with the page. It covers the page
 * only - the grid starts at the page's top-left corner, the same origin the snapping uses - and it
 * thins out when the cells get small on screen (`resolveGridDisplayStep`), so a zoomed-out page
 * shows every second or fifth line rather than turning grey. Sits above the page's content, under
 * the selection frame and the guides, and never takes the pointer.
 */
export const SurfaceGridOverlay = memo(function SurfaceGridOverlay({ designSize, spacing, viewport }: Props) {
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

    const path = useMemo(() => {
        if (!frame) {
            return null;
        }
        const lines = computeGridScreenLines({
            spacing,
            viewport,
            designSize,
            overlaySize: { width: frame.width, height: frame.height },
        });
        if (!lines) {
            return null;
        }
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
    }, [designSize, frame, spacing, viewport]);

    return (
        <div ref={hostRef} className="pointer-events-none absolute inset-0 overflow-hidden" data-surface-grid-overlay="">
            {frame && path ? (
                <svg
                    className="absolute left-0 top-0 text-fg-muted/30"
                    width={frame.width}
                    height={frame.height}
                    viewBox={`0 0 ${frame.width} ${frame.height}`}
                    aria-hidden="true"
                >
                    <path d={path} fill="none" stroke="currentColor" strokeWidth={1 / frame.dpr} />
                </svg>
            ) : null}
        </div>
    );
});
