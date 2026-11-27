import type { ViewportTransform } from "../geometry/types";
import type { ActiveSnapGuideSegment, ActiveSnapGuides, SnapGuideKind } from "./types";
import type { SnapGuideSpan } from "./guideSpans";
import { formatMeasure } from "../interaction/measure/measureGeometry";

type Props = {
    guides: ActiveSnapGuides;
    viewport: ViewportTransform;
    /**
     * Each guide's extent and gap (`resolveSnapGuideSpans`). Without it a guide is drawn across the
     * whole viewport, as it is while nothing says what is being lined up.
     */
    spans?: readonly SnapGuideSpan[] | null;
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
export function SnapGuidesOverlay({ guides, viewport, spans }: Props) {
    if (spans) {
        return <SnapGuideSpansOverlay spans={spans} viewport={viewport} />;
    }
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

/** A label sitting on a guide, saying how far apart the two things it lines up are. */
export function MeasureLabel({
    x,
    y,
    value,
    tone = "primary",
    beside,
}: {
    x: number;
    y: number;
    value: number;
    tone?: "primary" | "danger";
    /**
     * Set the label beside its line instead of on it: above a horizontal line ("above"), right of a
     * vertical one ("right"). For a short line, whose middle sits under a selection handle.
     */
    beside?: "above" | "right";
}) {
    const translate = beside === "above" ? "-50% calc(-100% - 6px)" : beside === "right" ? "10px -50%" : "-50% -50%";
    return (
        <div
            className={`absolute whitespace-nowrap rounded-sm px-1 font-mono text-2xs leading-4 ${
                tone === "danger" ? "bg-danger text-white" : "bg-primary text-on-primary"
            }`}
            // The `translate` property, not a Tailwind translate class: the engine's own Tailwind sheet on
            // this page defines its own translate utilities, and the two would stack or cancel.
            style={{ left: Math.round(x), top: Math.round(y), translate }}
        >
            {formatMeasure(value)}
        </div>
    );
}

function SnapGuideSpansOverlay({ spans, viewport }: { spans: readonly SnapGuideSpan[]; viewport: ViewportTransform }) {
    const seen = new Set<string>();
    const shown = spans.filter(span => {
        const px = Math.round(
            span.axis === "vertical" ? surfaceXToOverlayPx(span.value, viewport) : surfaceYToOverlayPx(span.value, viewport),
        );
        const key = `${span.axis}:${px}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
    if (shown.length === 0) {
        return null;
    }
    return (
        <div className="pointer-events-none absolute inset-0 z-[8]" data-ui-editor-snap-guides="">
            {shown.map((span, i) => {
                const tone = isEmphasizedSnapGuideKind(span.kind) ? "bg-primary/85" : "bg-primary/60";
                if (span.axis === "vertical") {
                    const left = Math.round(surfaceXToOverlayPx(span.value, viewport));
                    const top = surfaceYToOverlayPx(span.from, viewport);
                    const bottom = surfaceYToOverlayPx(span.to, viewport);
                    return (
                        <div key={`snap-v-${i}-${span.value}`}>
                            <div className={`absolute w-px ${tone}`} style={{ left, top, height: bottom - top }} />
                            {span.gap ? (
                                <MeasureLabel
                                    x={left}
                                    y={surfaceYToOverlayPx((span.gap.from + span.gap.to) / 2, viewport)}
                                    value={span.gap.to - span.gap.from}
                                />
                            ) : null}
                        </div>
                    );
                }
                const top = Math.round(surfaceYToOverlayPx(span.value, viewport));
                const left = surfaceXToOverlayPx(span.from, viewport);
                const right = surfaceXToOverlayPx(span.to, viewport);
                return (
                    <div key={`snap-h-${i}-${span.value}`}>
                        <div className={`absolute h-px ${tone}`} style={{ top, left, width: right - left }} />
                        {span.gap ? (
                            <MeasureLabel
                                x={surfaceXToOverlayPx((span.gap.from + span.gap.to) / 2, viewport)}
                                y={top}
                                value={span.gap.to - span.gap.from}
                            />
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
