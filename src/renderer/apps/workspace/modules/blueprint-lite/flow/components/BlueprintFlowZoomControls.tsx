/**
 * Zoom / fit controls styled like the rest of the workspace (replaces @xyflow/react Controls).
 * Comments in English per project convention.
 */

import { useReactFlow } from "@xyflow/react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/lib/components/elements/Button";

export function BlueprintFlowZoomControls() {
    const { zoomIn, zoomOut, fitView } = useReactFlow();

    return (
        <div
            className="absolute bottom-3 left-3 z-[5] flex flex-col gap-0.5 rounded-lg border border-white/10 bg-[#0b0d12] p-0.5 shadow-lg"
            onPointerDown={e => e.stopPropagation()}
        >
            <Button
                type="button"
                size="sm"
                variant="ghost"
                className="!min-h-0 !px-1.5 !py-1.5"
                aria-label="Zoom in"
                title="Zoom in"
                onClick={() => zoomIn({ duration: 180 })}
            >
                <ZoomIn className="h-3.5 w-3.5 text-gray-300" />
            </Button>
            <Button
                type="button"
                size="sm"
                variant="ghost"
                className="!min-h-0 !px-1.5 !py-1.5"
                aria-label="Zoom out"
                title="Zoom out"
                onClick={() => zoomOut({ duration: 180 })}
            >
                <ZoomOut className="h-3.5 w-3.5 text-gray-300" />
            </Button>
            <Button
                type="button"
                size="sm"
                variant="ghost"
                className="!min-h-0 !px-1.5 !py-1.5"
                aria-label="Fit view"
                title="Fit view"
                onClick={() => fitView({ duration: 220, padding: 0.2 })}
            >
                <Maximize2 className="h-3.5 w-3.5 text-gray-300" />
            </Button>
        </div>
    );
}
