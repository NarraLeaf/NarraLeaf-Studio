import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import type { UISurface, UISurfaceKind } from "@shared/types/ui-editor/document";
import { MoreVertical } from "lucide-react";
import { DEFAULT_APP_SURFACE_NAME, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";

import { formatStageMountLabel } from "./constants";

const SURFACE_PREVIEW_HEIGHT = 96;

type SurfaceListProps = {
    surfaces: UISurface[];
    surfaceKind: UISurfaceKind;
    globalBlueprintCard?: SurfaceListGlobalBlueprintCard;
    renderSurfacePreview?: (surface: UISurface) => ReactNode;
    onSurfaceClick: (surface: UISurface) => void;
    onOpenMenu: (event: MouseEvent<HTMLDivElement | HTMLButtonElement>, surface: UISurface) => void;
};

export type SurfaceListGlobalBlueprintCard = {
    title: string;
    subtitle: string;
    typeLabel: string;
    preview: ReactNode;
    canOpen: boolean;
    onClick: () => void;
};

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

const getSurfaceTypeLabel = (surface: UISurface): string => {
    if (surface.id === MAIN_APP_SURFACE_ID) {
        return DEFAULT_APP_SURFACE_NAME;
    }
    return surface.kind === "appSurface" ? "Page" : "Game UI";
};

export function SurfaceList({
    surfaces,
    surfaceKind,
    globalBlueprintCard,
    renderSurfacePreview,
    onSurfaceClick,
    onOpenMenu,
}: SurfaceListProps) {
    if (surfaces.length === 0 && !globalBlueprintCard) {
        const kindLabel = surfaceKind === "appSurface" ? "pages" : "game UI canvases";
        const emptyPrimary = `No ${kindLabel} yet.`;
        const emptySecondary =
            surfaceKind === "appSurface"
                ? "Use Create Page above. Pages can be opened as full screens and later called as game layers."
                : "Use Create Game UI above. Game UI is fixed to the project resolution.";

        return (
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 bg-[#0b0d12]">
                <p className="text-xs text-gray-400">{emptyPrimary}</p>
                <p className="text-xs text-gray-500">{emptySecondary}</p>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 bg-[#0b0d12]">
            {globalBlueprintCard ? (
                <button
                    type="button"
                    className="group w-full text-left rounded-md border border-white/10 bg-[#0b0d12] px-3 py-2 transition-colors hover:bg-white/5 disabled:cursor-default disabled:hover:bg-[#0b0d12]"
                    disabled={!globalBlueprintCard.canOpen}
                    onClick={globalBlueprintCard.onClick}
                    onContextMenu={event => event.preventDefault()}
                    aria-label={
                        globalBlueprintCard.canOpen ? "Open global blueprint" : "Global blueprint unavailable"
                    }
                >
                    <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-white truncate">{globalBlueprintCard.title}</div>
                            <div className="text-[11px] text-gray-400">{globalBlueprintCard.subtitle}</div>
                            <div className="text-[11px] text-gray-500">{globalBlueprintCard.typeLabel}</div>
                        </div>
                    </div>
                    <div className="mt-2">{globalBlueprintCard.preview}</div>
                </button>
            ) : null}
            {surfaces.map(surface => {
                const preview = renderSurfacePreview?.(surface);
                const typeLabel = getSurfaceTypeLabel(surface);
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
                                <div className="text-[11px] text-gray-500">{typeLabel}</div>
                                {surface.kind === "stageSurface" && (
                                    <div className="text-[11px] text-gray-500">{formatStageMountLabel(surface.mount)}</div>
                                )}
                            </div>
                            <button
                                type="button"
                                className="p-1 rounded hover:bg-white/10 text-gray-300 opacity-0 group-hover:opacity-100"
                                onClick={event => onOpenMenu(event, surface)}
                                title={`${typeLabel} actions`}
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
