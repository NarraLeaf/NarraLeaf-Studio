import { memo, useCallback } from "react";
import type { MouseEvent, ReactNode } from "react";
import type { UISurface } from "@shared/types/ui-editor/document";
import { MoreVertical } from "lucide-react";
import { DEFAULT_APP_SURFACE_NAME, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { useTranslation } from "@/lib/i18n";
import type { UseTranslation } from "@/lib/i18n";

import { formatStageMountLabel } from "./constants";
import { LivePreviewFrame } from "./LivePreviewFrame";

const SURFACE_PREVIEW_HEIGHT = 96;
const SURFACE_PREVIEW_FRAME_CLASS = "mt-2 h-24 w-full overflow-hidden rounded-md border border-edge bg-surface-canvas";

type SurfaceListProps = {
    surfaces: UISurface[];
    globalBlueprintCard?: SurfaceListGlobalBlueprintCard;
    renderSurfacePreview?: (surface: UISurface) => ReactNode;
    /** Moves only when this surface's own content changed; keeps one page's edit off the other cards. */
    getSurfaceContentRevision?: (surface: UISurface) => number;
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
    /** Right click: open the blueprint in a window of its own, as every blueprint entry does. */
    onOpenInWindow: () => void;
};

const getSurfaceTypeLabel = (surface: UISurface, t: UseTranslation["t"]): string => {
    if (surface.id === MAIN_APP_SURFACE_ID) {
        return DEFAULT_APP_SURFACE_NAME;
    }
    return surface.kind === "appSurface" ? t("uiEditor.surfaceKind.page") : t("uiEditor.surfaceKind.gameUi");
};

type SurfaceRowProps = {
    surface: UISurface;
    typeLabel: string;
    /** Localized stage slot this Game UI mounts into; absent for a Page. */
    mountLabel?: string;
    actionsLabel: string;
    contentRevision: number;
    renderPreview: () => ReactNode;
    onSurfaceClick: (surface: UISurface) => void;
    onOpenMenu: (event: MouseEvent<HTMLDivElement | HTMLButtonElement>, surface: UISurface) => void;
};

/**
 * One card in the list.
 *
 * Memoised on the surface record and its content revision rather than re-rendered with the list:
 * the panel re-renders on every document change, and without this the card's live preview would be
 * rebuilt for edits made to a completely different page. `UIDocumentService` mutates surfaces in
 * place, so the record's identity does not tell you whether it changed - the revision does.
 */
const SurfaceRow = memo(
    function SurfaceRow({
        surface,
        typeLabel,
        mountLabel,
        actionsLabel,
        contentRevision,
        renderPreview,
        onSurfaceClick,
        onOpenMenu,
    }: SurfaceRowProps) {
        const handleClick = useCallback(() => onSurfaceClick(surface), [onSurfaceClick, surface]);
        const handleMenu = useCallback(
            (event: MouseEvent<HTMLDivElement | HTMLButtonElement>) => onOpenMenu(event, surface),
            [onOpenMenu, surface],
        );

        return (
            <div
                className="group w-full text-left rounded-md border border-edge bg-surface-raised px-3 py-2 transition-colors hover:bg-fill-subtle"
                onClick={handleClick}
                onContextMenu={handleMenu}
                role="button"
                tabIndex={0}
            >
                <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-fg truncate">{surface.name}</div>
                        <div className="text-2xs text-fg-muted">
                            {surface.designSize.width}×{surface.designSize.height}
                        </div>
                        <div className="text-2xs text-fg-subtle">{typeLabel}</div>
                        {mountLabel ? <div className="text-2xs text-fg-subtle">{mountLabel}</div> : null}
                    </div>
                    <button
                        type="button"
                        className="p-1 rounded-md hover:bg-fill text-fg-muted opacity-0 group-hover:opacity-100"
                        onClick={handleMenu}
                        title={actionsLabel}
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>
                </div>
                <LivePreviewFrame
                    previewId={surface.id}
                    contentRevision={contentRevision}
                    render={renderPreview}
                    designWidth={surface.designSize.width}
                    designHeight={surface.designSize.height}
                    frameHeight={SURFACE_PREVIEW_HEIGHT}
                    className={SURFACE_PREVIEW_FRAME_CLASS}
                />
            </div>
        );
    },
    (previous, next) =>
        previous.surface === next.surface &&
        previous.contentRevision === next.contentRevision &&
        previous.typeLabel === next.typeLabel &&
        previous.mountLabel === next.mountLabel &&
        previous.actionsLabel === next.actionsLabel &&
        previous.onSurfaceClick === next.onSurfaceClick &&
        previous.onOpenMenu === next.onOpenMenu,
);

export function SurfaceList({
    surfaces,
    globalBlueprintCard,
    renderSurfacePreview,
    getSurfaceContentRevision,
    onSurfaceClick,
    onOpenMenu,
}: SurfaceListProps) {
    const { t } = useTranslation();
    // Nothing to list yet: the list is empty and stays empty. The Create Page / Create Game UI
    // button is the row directly above this pane (SurfaceActions), so two lines saying there are no
    // pages and to press that button are the button described rather than offered.
    if (surfaces.length === 0 && !globalBlueprintCard) {
        return <div className="flex-1 overflow-y-auto px-2 py-2" />;
    }

    return (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
            {globalBlueprintCard ? (
                <button
                    type="button"
                    className="group w-full text-left rounded-md border border-edge bg-surface-raised px-3 py-2 transition-colors hover:bg-fill-subtle disabled:cursor-default disabled:hover:bg-surface-raised"
                    disabled={!globalBlueprintCard.canOpen}
                    onClick={globalBlueprintCard.onClick}
                    onContextMenu={event => {
                        event.preventDefault();
                        if (globalBlueprintCard.canOpen) {
                            globalBlueprintCard.onOpenInWindow();
                        }
                    }}
                    title={globalBlueprintCard.canOpen ? t("blueprint.entry.openInWindow") : undefined}
                    aria-label={
                        globalBlueprintCard.canOpen
                            ? t("uiEditor.panel.openGlobalBlueprint")
                            : t("uiEditor.panel.globalBlueprintUnavailable")
                    }
                >
                    <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-fg truncate">{globalBlueprintCard.title}</div>
                            <div className="text-2xs text-fg-muted">{globalBlueprintCard.subtitle}</div>
                            <div className="text-2xs text-fg-subtle">{globalBlueprintCard.typeLabel}</div>
                        </div>
                    </div>
                    <div className="mt-2">{globalBlueprintCard.preview}</div>
                </button>
            ) : null}
            {surfaces.map(surface => {
                const typeLabel = getSurfaceTypeLabel(surface, t);
                return (
                    <SurfaceRow
                        key={surface.id}
                        surface={surface}
                        typeLabel={typeLabel}
                        mountLabel={
                            surface.kind === "stageSurface" ? formatStageMountLabel(surface.mount, t) : undefined
                        }
                        actionsLabel={t("uiEditor.panel.surfaceActions", { label: typeLabel })}
                        contentRevision={getSurfaceContentRevision?.(surface) ?? 0}
                        renderPreview={() => renderSurfacePreview?.(surface) ?? null}
                        onSurfaceClick={onSurfaceClick}
                        onOpenMenu={onOpenMenu}
                    />
                );
            })}
        </div>
    );
}
