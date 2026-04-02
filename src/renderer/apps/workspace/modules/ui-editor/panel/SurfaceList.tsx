import type { MouseEvent } from "react";
import type { UIStageSurfaceMount, UISurface, UISurfaceKind } from "@shared/types/ui-editor/document";
import { MoreVertical } from "lucide-react";

import { formatStageMountLabel } from "./constants";

type SurfaceListProps = {
    surfaces: UISurface[];
    /** Current filter tab (app vs stage). */
    surfaceKind: UISurfaceKind;
    /** Stage mount filter when `surfaceKind === "stageSurface"`; ignored for app. */
    stageMountFilter: UIStageSurfaceMount["kind"] | null;
    /** Count of surfaces matching `surfaceKind` before mount filter. */
    surfacesOfKindCount: number;
    onSurfaceClick: (surface: UISurface) => void;
    onOpenMenu: (event: MouseEvent<HTMLDivElement | HTMLButtonElement>, surface: UISurface) => void;
};

export function SurfaceList({
    surfaces,
    surfaceKind,
    stageMountFilter,
    surfacesOfKindCount,
    onSurfaceClick,
    onOpenMenu,
}: SurfaceListProps) {
    if (surfaces.length === 0) {
        const kindLabel = surfaceKind === "appSurface" ? "App" : "Stage";
        const noKindYet = surfacesOfKindCount === 0;
        const emptyPrimary = noKindYet
            ? `No ${kindLabel} surfaces yet.`
            : `No ${kindLabel} surfaces match the current filter.`;
        const emptySecondary = noKindYet
            ? "Use Create Surface above. The canvas is layout-only here; open Dev Mode from the editor tab for runtime preview."
            : surfaceKind === "stageSurface" && stageMountFilter
              ? "Try “All” or another Stage Mount filter, or create a new stage surface."
              : "Adjust filters or create a new surface.";

        return (
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 bg-[#0b0d12]">
                <p className="text-xs text-gray-400">{emptyPrimary}</p>
                <p className="text-xs text-gray-500">{emptySecondary}</p>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 bg-[#0b0d12]">
            {surfaces.map(surface => (
                <div
                    key={surface.id}
                    className="group w-full text-left rounded-md border border-white/10 bg-[#0b0d12] px-3 py-2 transition-colors hover:bg-white/5"
                    onClick={() => onSurfaceClick(surface)}
                    onContextMenu={event => onOpenMenu(event, surface)}
                    role="button"
                    tabIndex={0}
                >
                    <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-white truncate">{surface.name}</div>
                            <div className="text-[11px] text-gray-400">
                                {surface.designSize.width}×{surface.designSize.height}
                            </div>
                            <div className="text-[11px] text-gray-500">{surface.host}</div>
                            {surface.kind === "stageSurface" && (
                                <div className="text-[11px] text-gray-500">{formatStageMountLabel(surface.mount)}</div>
                            )}
                        </div>
                        <button
                            type="button"
                            className="p-1 rounded hover:bg-white/10 text-gray-300 opacity-0 group-hover:opacity-100"
                            onClick={event => onOpenMenu(event, surface)}
                            title="Surface actions"
                        >
                            <MoreVertical className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
