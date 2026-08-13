import { ChevronLeft, ImageOff, Loader2 } from "lucide-react";
import { Button } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { resolveLocalizedText } from "@shared/types/localizedText";
import type { UITemplateRegistryEntry } from "@shared/types/uiTemplateRegistry";
import type { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import { TemplatePreviewFrame, type UITemplatePreviewState } from "./UITemplateCard";

type UITemplateDetailProps = {
    entry: UITemplateRegistryEntry;
    preview: UITemplatePreviewState;
    runtimeBridge: UIRuntimeBridgeService | null;
    placementLabel: string;
    blockedReason?: string;
    busy: boolean;
    onAdd: () => void;
    onBack: () => void;
};

/**
 * One template, at a size worth looking at.
 *
 * The grid has to fit several screens across, so its previews are small and its
 * descriptions are clamped to two lines — which is fine for recognising a
 * template and useless for deciding on one. This is where the picture is big
 * enough to read the layout and the description is not cut off.
 */
export function UITemplateDetail({
    entry,
    preview,
    runtimeBridge,
    placementLabel,
    blockedReason,
    busy,
    onAdd,
    onBack,
}: UITemplateDetailProps) {
    const { t, locale } = useTranslation();
    const text = resolveLocalizedText(entry, locale);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onBack}>
                    <ChevronLeft className="h-4 w-4" />
                    {t("uiEditor.templateStore.detailBack")}
                </Button>
            </div>

            {/* Side by side, because the two things this view exists for - a
                preview big enough to read and a description that is not clamped -
                are both meant to be visible without scrolling for either. */}
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pr-1 md:grid-cols-[1.4fr_1fr]">
                <div className="aspect-video w-full self-start overflow-hidden rounded-md border border-edge bg-surface-canvas">
                    {preview.status === "ready" ? (
                        <TemplatePreviewFrame document={preview.document} runtimeBridge={runtimeBridge} />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-fg-subtle">
                            {preview.status === "loading"
                                ? <Loader2 className="h-6 w-6 animate-spin" />
                                : <ImageOff className="h-6 w-6" />}
                        </div>
                    )}
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                    <div className="text-base font-medium text-fg">{text.name}</div>
                    <dl className="flex flex-col gap-1.5 text-xs">
                        <div className="flex gap-2">
                            <dt className="w-16 shrink-0 text-fg-subtle">{t("uiEditor.templateStore.target")}</dt>
                            <dd className="min-w-0 text-fg-muted">{placementLabel}</dd>
                        </div>
                        {entry.publisher ? (
                            <div className="flex gap-2">
                                <dt className="w-16 shrink-0 text-fg-subtle">{t("uiEditor.templateStore.publisher")}</dt>
                                <dd className="min-w-0 truncate text-fg-muted">{entry.publisher}</dd>
                            </div>
                        ) : null}
                        {entry.version ? (
                            <div className="flex gap-2">
                                <dt className="w-16 shrink-0 text-fg-subtle">{t("uiEditor.templateStore.version")}</dt>
                                <dd className="text-fg-muted tabular-nums">{entry.version}</dd>
                            </div>
                        ) : null}
                    </dl>
                    {/* Not clamped: the whole reason to be on this screen. */}
                    <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                        {text.description || t("uiEditor.templateStore.noDescription")}
                    </p>
                </div>
            </div>

            <div className="shrink-0 border-t border-edge pt-3">
                <Button
                    variant="primary"
                    size="sm"
                    fullWidth
                    disabled={busy || Boolean(blockedReason)}
                    data-tip={blockedReason}
                    onClick={onAdd}
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {blockedReason ? t("uiEditor.templateStore.slotOccupied") : t("uiEditor.templateStore.add")}
                </Button>
            </div>
        </div>
    );
}
