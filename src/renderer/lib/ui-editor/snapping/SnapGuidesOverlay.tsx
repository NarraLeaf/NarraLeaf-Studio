import type { ViewportTransform } from "../geometry/types";
import type { ActiveSnapGuides } from "./types";

type Props = {
    guides: ActiveSnapGuides;
    viewport: ViewportTransform;
};

/**
 * Renders snap guide lines in viewport coordinates (same mapping as insert preview).
 */
export function SnapGuidesOverlay({ guides, viewport }: Props) {
    if (guides.vertical.length === 0 && guides.horizontal.length === 0) {
        return null;
    }
    return (
        <div className="pointer-events-none absolute inset-0 z-[8]">
            {guides.vertical.map((vx, i) => {
                const left = vx * viewport.scale + viewport.offsetX;
                return (
                    <div
                        key={`snap-v-${i}-${vx}`}
                        className="absolute top-0 bottom-0 w-px bg-primary/65"
                        style={{ left }}
                    />
                );
            })}
            {guides.horizontal.map((hy, i) => {
                const top = hy * viewport.scale + viewport.offsetY;
                return (
                    <div
                        key={`snap-h-${i}-${hy}`}
                        className="absolute left-0 right-0 h-px bg-primary/65"
                        style={{ top }}
                    />
                );
            })}
        </div>
    );
}
