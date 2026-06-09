import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import type { UIStageSurface, UIStageSurfaceMount, UISurface, UISurfaceKind } from "@shared/types/ui-editor/document";
import { MoreVertical } from "lucide-react";

import { formatStageMountLabel } from "./constants";

const SURFACE_PREVIEW_HEIGHT = 96;

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
    renderSurfacePreview?: (surface: UISurface) => ReactNode;
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

function SurfacePreview({ surface, children }: { surface: UISurface; children: ReactNode }) {
    const frameRef = useRef<HTMLDivElement | null>(null);
    const [frameWidth, setFrameWidth] = useState(0);

    useEffect(() => {
        const node = frameRef.current;
        if (!node) {
            return undefined;
        }

        const updateWidth = (width: number) => {
            setFrameWidth(Math.max(0, width));
        };

        updateWidth(node.clientWidth);

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            updateWidth(entry?.contentRect.width ?? node.clientWidth);
        });
        observer.observe(node);

        return () => {
            observer.disconnect();
        };
    }, []);

    const designWidth = Math.max(1, surface.designSize.width);
    const designHeight = Math.max(1, surface.designSize.height);
    const scale = frameWidth > 0 ? Math.min(frameWidth / designWidth, SURFACE_PREVIEW_HEIGHT / designHeight) : 0;
    const scaledWidth = designWidth * scale;
    const scaledHeight = designHeight * scale;
    const contentStyle: CSSProperties = {
        left: Math.max(0, (frameWidth - scaledWidth) / 2),
        top: Math.max(0, (SURFACE_PREVIEW_HEIGHT - scaledHeight) / 2),
        width: designWidth,
        height: designHeight,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
    };

    return (
        <div
            ref={frameRef}
            className="mt-2 h-24 w-full overflow-hidden rounded-md border border-white/10 bg-[#05060a]"
            aria-hidden="true"
        >
            <div className="relative h-full w-full">
                {scale > 0 ? (
                    <div className="absolute pointer-events-none" style={contentStyle}>
                        {children}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export function SurfaceList({
    surfaces,
    surfaceKind,
    stageMountFilter,
    surfacesOfKindCount,
    allSurfaces,
    renderSurfacePreview,
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
                            ? `Static issues · ${diag.errors} error(s)${diag.warnings ? `, ${diag.warnings} warning(s)` : ""}`
                            : `Static issues · ${diag.warnings} warning(s)`
                        : null;
                const preview = renderSurfacePreview?.(surface);
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
                    <SurfacePreview surface={surface}>{preview}</SurfacePreview>
                </div>
            );
            })}
        </div>
    );
}
