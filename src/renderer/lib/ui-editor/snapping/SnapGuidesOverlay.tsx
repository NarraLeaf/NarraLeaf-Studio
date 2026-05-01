import type { ViewportTransform } from "../geometry/types";
import type { ActiveSnapGuideSegment, ActiveSnapGuides, SnapGuideKind } from "./types";

type Props = {
    guides: ActiveSnapGuides;
    viewport: ViewportTransform;
};

function isEmphasizedSnapGuideKind(kind: SnapGuideKind): boolean {
    return kind === "surface-edge" || kind === "surface-center";
}

/** Surface design space → overlay pixel X (same as insert preview). */
function surfaceXToOverlayPx(surfaceX: number, viewport: ViewportTransform): number {
    return surfaceX * viewport.scale + viewport.offsetX;
}

function surfaceYToOverlayPx(surfaceY: number, viewport: ViewportTransform): number {
    return surfaceY * viewport.scale + viewport.offsetY;
}

/**
 * Drop segments that map to the same device-pixel row/column so stacked 1px lines do not read as "thick"
 * (e.g. surface center + element center at the same x after rounding).
 */
function dedupeSegmentsByRoundedScreenPixel(
    vertical: readonly ActiveSnapGuideSegment[],
    horizontal: readonly ActiveSnapGuideSegment[],
    viewport: ViewportTransform,
): { vertical: ActiveSnapGuideSegment[]; horizontal: ActiveSnapGuideSegment[] } {
    const vOut: ActiveSnapGuideSegment[] = [];
    const vSeen = new Set<number>();
    for (const seg of vertical) {
        const px = Math.round(surfaceXToOverlayPx(seg.value, viewport));
        if (vSeen.has(px)) {
            continue;
        }
        vSeen.add(px);
        vOut.push(seg);
    }
    const hOut: ActiveSnapGuideSegment[] = [];
    const hSeen = new Set<number>();
    for (const seg of horizontal) {
        const py = Math.round(surfaceYToOverlayPx(seg.value, viewport));
        if (hSeen.has(py)) {
            continue;
        }
        hSeen.add(py);
        hOut.push(seg);
    }
    return { vertical: vOut, horizontal: hOut };
}

/**
 * Renders snap guide lines in viewport coordinates (same mapping as insert preview).
 * Pixel-snaps positions and avoids translate(-50%) so subpixel centers (typical at canvas mid vertical)
 * do not blur into a wide line.
 */
export function SnapGuidesOverlay({ guides, viewport }: Props) {
    const { vertical, horizontal } = dedupeSegmentsByRoundedScreenPixel(
        guides.vertical,
        guides.horizontal,
        viewport,
    );
    if (vertical.length === 0 && horizontal.length === 0) {
        return null;
    }
    return (
        <div className="pointer-events-none absolute inset-0 z-[8]">
            {vertical.map((seg, i) => {
                const leftPx = Math.round(surfaceXToOverlayPx(seg.value, viewport));
                const emphasized = isEmphasizedSnapGuideKind(seg.kind);
                return (
                    <div
                        key={`snap-v-${i}-${seg.value}-${seg.kind}`}
                        className={
                            emphasized
                                ? "absolute top-0 bottom-0 w-px bg-primary/85"
                                : "absolute top-0 bottom-0 w-px bg-primary/60"
                        }
                        style={{ left: leftPx }}
                    />
                );
            })}
            {horizontal.map((seg, i) => {
                const topPx = Math.round(surfaceYToOverlayPx(seg.value, viewport));
                const emphasized = isEmphasizedSnapGuideKind(seg.kind);
                return (
                    <div
                        key={`snap-h-${i}-${seg.value}-${seg.kind}`}
                        className={
                            emphasized
                                ? "absolute left-0 right-0 h-px bg-primary/85"
                                : "absolute left-0 right-0 h-px bg-primary/60"
                        }
                        style={{ top: topPx }}
                    />
                );
            })}
        </div>
    );
}
