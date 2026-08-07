import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { Button } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { UITemplateRegistryEntry } from "@shared/types/uiTemplateRegistry";
import { resolveLocalizedText } from "@shared/types/localizedText";
import type { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";

/** What the card knows about its own picture. */
export type UITemplatePreviewState =
    | { status: "loading" }
    | { status: "ready"; document: UIDocument }
    | { status: "unavailable" };

type UITemplateCardProps = {
    entry: UITemplateRegistryEntry;
    preview: UITemplatePreviewState;
    runtimeBridge: UIRuntimeBridgeService | null;
    /** Localized destination, e.g. the stage slot this Game UI would mount into. */
    placementLabel: string;
    /** Set when the template cannot be added right now, and says why. */
    blockedReason?: string;
    busy: boolean;
    onAdd: () => void;
    /** Open the detail view. The card body is the control; Add is not. */
    onOpenDetail: () => void;
};

/**
 * The template's own document, drawn at card size.
 *
 * The surface is rendered at its authored design size and scaled down to fit,
 * rather than being letterboxed into a fixed frame — a Game UI authored for a
 * 1280×720 stage and a Page authored for 1920×1080 then read at the same
 * proportions they will have in the editor.
 */
export function TemplatePreviewFrame({
    document,
    runtimeBridge,
}: {
    document: UIDocument;
    runtimeBridge: UIRuntimeBridgeService | null;
}) {
    const frameRef = useRef<HTMLDivElement | null>(null);
    const [frameSize, setFrameSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

    useLayoutEffect(() => {
        const node = frameRef.current;
        if (!node) {
            return undefined;
        }
        const update = () => setFrameSize({ width: node.clientWidth, height: node.clientHeight });
        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    // A template's own surface, never the default main one: `importTemplateBundle`
    // filters that id out too, so previewing it would show what will not arrive.
    const surface = useMemo(
        () => document.surfaces.find(candidate => candidate.id !== MAIN_APP_SURFACE_ID) ?? null,
        [document],
    );

    const rendered = useMemo(() => {
        if (!surface || !runtimeBridge) {
            return null;
        }
        return runtimeBridge.renderDocumentSurface({
            document,
            surfaceId: surface.id,
            hostAdapter: { host: surface.host },
            editorChrome: false,
        });
    }, [document, runtimeBridge, surface]);

    const designWidth = Math.max(1, surface?.designSize.width ?? 1);
    const designHeight = Math.max(1, surface?.designSize.height ?? 1);
    const scale = frameSize.width > 0 && frameSize.height > 0
        ? Math.min(frameSize.width / designWidth, frameSize.height / designHeight)
        : 0;

    return (
        <div ref={frameRef} className="relative h-full w-full overflow-hidden">
            {scale > 0 && rendered ? (
                <div
                    className="pointer-events-none absolute"
                    style={{
                        left: (frameSize.width - designWidth * scale) / 2,
                        top: (frameSize.height - designHeight * scale) / 2,
                        width: designWidth,
                        height: designHeight,
                        transform: `scale(${scale})`,
                        transformOrigin: "top left",
                    }}
                >
                    {rendered}
                </div>
            ) : null}
        </div>
    );
}

export function UITemplateCard({
    entry,
    preview,
    runtimeBridge,
    placementLabel,
    blockedReason,
    busy,
    onAdd,
    onOpenDetail,
}: UITemplateCardProps) {
    const { t, locale } = useTranslation();
    const text = resolveLocalizedText(entry, locale);

    return (
        <div className="flex flex-col overflow-hidden rounded-md border border-edge bg-surface-raised">
            {/* Stage-shaped, and the darkest surface: a Game UI is authored over a
                transparent stage, so it needs a ground dark enough to read against. */}
            <button
                type="button"
                onClick={onOpenDetail}
                className="flex min-w-0 flex-1 flex-col text-left"
                title={t("uiEditor.templateStore.openDetail")}
            >
            <div className="relative aspect-video w-full shrink-0 bg-surface-canvas">
                {preview.status === "ready" ? (
                    <TemplatePreviewFrame document={preview.document} runtimeBridge={runtimeBridge} />
                ) : (
                    <div className="flex h-full w-full items-center justify-center text-fg-subtle">
                        {preview.status === "loading" ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                            <ImageOff className="h-5 w-5" />
                        )}
                    </div>
                )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
                <div className="truncate text-sm font-medium text-fg" title={text.name}>
                    {text.name}
                </div>
                <div className="flex min-w-0 items-center gap-1.5 text-2xs text-fg-subtle">
                    <span className="truncate">{placementLabel}</span>
                    {entry.publisher ? (
                        <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{entry.publisher}</span>
                        </>
                    ) : null}
                </div>
                {text.description ? (
                    <p className="line-clamp-2 text-xs leading-relaxed text-fg-muted">{text.description}</p>
                ) : null}
            </div>
            </button>

            <div className="p-3 pt-0">
                <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                        disabled={busy || Boolean(blockedReason)}
                        // The reason a card refuses lives on the control that refuses,
                        // so it is readable without adding a second line to every card
                        // that is perfectly fine.
                        title={blockedReason}
                        onClick={onAdd}
                    >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {blockedReason ? t("uiEditor.templateStore.slotOccupied") : t("uiEditor.templateStore.add")}
                </Button>
            </div>
        </div>
    );
}

/** Shared by the grid's loading skeletons so they match the real card's shape. */
export function UITemplateCardSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn("flex flex-col overflow-hidden rounded-md border border-edge bg-surface-raised", className)}>
            <div className="aspect-video w-full shrink-0 animate-pulse bg-fill-subtle" />
            <div className="flex flex-col gap-2 p-3">
                <div className="h-3.5 w-2/3 animate-pulse rounded-sm bg-fill-subtle" />
                <div className="h-2.5 w-1/2 animate-pulse rounded-sm bg-fill-subtle" />
            </div>
        </div>
    );
}
