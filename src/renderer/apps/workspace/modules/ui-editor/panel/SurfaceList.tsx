import type { MouseEvent } from "react";
import type { UIStageSurface, UIStageSurfaceMount, UISurface, UISurfaceKind } from "@shared/types/ui-editor/document";
import { MoreVertical } from "lucide-react";

import { formatStageMountLabel } from "./constants";

export type SurfaceDiagnosticSummary = { errors: number; warnings: number };

type SurfaceListProps = {
    surfaces: UISurface[];
    /** Current filter tab (app vs stage). */
    surfaceKind: UISurfaceKind;
    /** Stage mount filter when `surfaceKind === "stageSurface"`; ignored for app. */
    stageMountFilter: UIStageSurfaceMount["kind"] | null;
    /** Count of surfaces matching `surfaceKind` before mount filter. */
    surfacesOfKindCount: number;
    /** Full surface list (unfiltered) to resolve Stage → App Surface link names. */
    allSurfaces: UISurface[];
    /** Static editor diagnostics (Visual Editor M5); Dev Mode shows runtime traces. */
    diagnosticSummaryBySurfaceId?: Record<string, SurfaceDiagnosticSummary>;
    onSurfaceClick: (surface: UISurface) => void;
    onOpenMenu: (event: MouseEvent<HTMLDivElement | HTMLButtonElement>, surface: UISurface) => void;
};

function stageLinkCaption(surface: UISurface, allSurfaces: UISurface[]): string | null {
    if (surface.kind !== "stageSurface") {
        return null;
    }
    const st = surface as UIStageSurface;
    if (st.link?.kind !== "appSurface") {
        return null;
    }
    const target = allSurfaces.find(s => s.id === st.link?.surfaceId);
    const name = target?.name ?? "Missing app surface";
    return `App Surface link · ${name}`;
}

export function SurfaceList({
    surfaces,
    surfaceKind,
    stageMountFilter,
    surfacesOfKindCount,
    allSurfaces,
    diagnosticSummaryBySurfaceId,
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
            {surfaces.map(surface => {
                const linkLine = stageLinkCaption(surface, allSurfaces);
                const diag = diagnosticSummaryBySurfaceId?.[surface.id];
                const diagLine =
                    diag && (diag.errors > 0 || diag.warnings > 0)
                        ? diag.errors > 0
                            ? `Static issues · ${diag.errors} error(s)${diag.warnings ? `, ${diag.warnings} warning(s)` : ""}`
                            : `Static issues · ${diag.warnings} warning(s)`
                        : null;
                return (
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
                            {linkLine ? <div className="text-[11px] text-gray-500 truncate">{linkLine}</div> : null}
                            {diagLine ? (
                                <div className="text-[11px] text-amber-400/90 truncate" title="Editor static checks only">
                                    {diagLine}
                                </div>
                            ) : null}
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
            );
            })}
        </div>
    );
}
