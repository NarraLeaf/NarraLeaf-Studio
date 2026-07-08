import type { UIDocument } from "@shared/types/ui-editor/document";
import { getElementSurfaceTopLeft } from "@/lib/ui-editor/layout/elementSurfaceGeometry";

export function SurfaceLayoutDiagnosticMarkers(props: {
    document: UIDocument;
    hints: { elementId: string; label: string }[];
}) {
    const { document, hints } = props;
    if (hints.length === 0) {
        return null;
    }
    return (
        <div className="pointer-events-none absolute inset-0 z-[5]">
            {hints.map(hint => {
                const el = document.elements[hint.elementId];
                if (!el) {
                    return null;
                }
                const { width, height } = el.layout;
                const origin = getElementSurfaceTopLeft(document, hint.elementId);
                const boxW = Math.abs(width);
                const boxH = Math.abs(height);
                return (
                    <div
                        key={hint.elementId}
                        className="absolute rounded-sm border border-amber-500/45 bg-amber-500/[0.07]"
                        style={{
                            left: origin.x,
                            top: origin.y,
                            width: Math.max(boxW, 2),
                            height: Math.max(boxH, 2),
                        }}
                    >
                        <span className="absolute left-0 top-full z-10 mt-0.5 max-w-[240px] truncate rounded bg-black/75 px-1 py-0.5 text-2xs leading-tight text-amber-100/95 shadow-sm">
                            {hint.label}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
