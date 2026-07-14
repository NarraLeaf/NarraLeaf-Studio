import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import type { UISurface, UISurfaceKind } from "@shared/types/ui-editor/document";
import { MoreVertical } from "lucide-react";
import { DEFAULT_APP_SURFACE_NAME, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { useTranslation } from "@/lib/i18n";
import type { UseTranslation } from "@/lib/i18n";

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
            className="mt-2 h-24 w-full overflow-hidden rounded-md border border-edge bg-surface-canvas"
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

const getSurfaceTypeLabel = (surface: UISurface, t: UseTranslation["t"]): string => {
    if (surface.id === MAIN_APP_SURFACE_ID) {
        return DEFAULT_APP_SURFACE_NAME;
    }
    return surface.kind === "appSurface" ? t("uiEditor.surfaceKind.page") : t("uiEditor.surfaceKind.gameUi");
};

export function SurfaceList({
    surfaces,
    surfaceKind,
    globalBlueprintCard,
    renderSurfacePreview,
    onSurfaceClick,
    onOpenMenu,
}: SurfaceListProps) {
    const { t } = useTranslation();
    if (surfaces.length === 0 && !globalBlueprintCard) {
        const emptyPrimary = surfaceKind === "appSurface" ? t("uiEditor.panel.emptyPages") : t("uiEditor.panel.emptyGameUi");
        const emptySecondary =
            surfaceKind === "appSurface"
                ? t("uiEditor.panel.emptyPagesHint")
                : t("uiEditor.panel.emptyGameUiHint");

        return (
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 bg-surface-sunken">
                <p className="text-xs text-fg-muted">{emptyPrimary}</p>
                <p className="text-xs text-fg-subtle">{emptySecondary}</p>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 bg-surface-sunken">
            {globalBlueprintCard ? (
                <button
                    type="button"
                    className="group w-full text-left rounded-md border border-edge bg-surface-sunken px-3 py-2 transition-colors hover:bg-fill-subtle disabled:cursor-default disabled:hover:bg-surface-sunken"
                    disabled={!globalBlueprintCard.canOpen}
                    onClick={globalBlueprintCard.onClick}
                    onContextMenu={event => event.preventDefault()}
                    aria-label={
                        globalBlueprintCard.canOpen
                            ? t("uiEditor.panel.openGlobalBlueprint")
                            : t("uiEditor.panel.globalBlueprintUnavailable")
                    }
                >
                    <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-white truncate">{globalBlueprintCard.title}</div>
                            <div className="text-2xs text-fg-muted">{globalBlueprintCard.subtitle}</div>
                            <div className="text-2xs text-fg-subtle">{globalBlueprintCard.typeLabel}</div>
                        </div>
                    </div>
                    <div className="mt-2">{globalBlueprintCard.preview}</div>
                </button>
            ) : null}
            {surfaces.map(surface => {
                const preview = renderSurfacePreview?.(surface);
                const typeLabel = getSurfaceTypeLabel(surface, t);
                return (
                    <div
                        key={surface.id}
                        className="group w-full text-left rounded-md border border-edge bg-surface-sunken px-3 py-2 transition-colors hover:bg-fill-subtle"
                        onClick={() => onSurfaceClick(surface)}
                        onContextMenu={event => onOpenMenu(event, surface)}
                        role="button"
                        tabIndex={0}
                    >
                        <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-white truncate">{surface.name}</div>
                                <div className="text-2xs text-fg-muted">
                                    {surface.designSize.width}×{surface.designSize.height}
                                </div>
                                <div className="text-2xs text-fg-subtle">{typeLabel}</div>
                                {surface.kind === "stageSurface" && (
                                    <div className="text-2xs text-fg-subtle">{formatStageMountLabel(surface.mount)}</div>
                                )}
                            </div>
                            <button
                                type="button"
                                className="p-1 rounded hover:bg-fill text-fg-muted opacity-0 group-hover:opacity-100"
                                onClick={event => onOpenMenu(event, surface)}
                                title={t("uiEditor.panel.surfaceActions", { label: typeLabel })}
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
