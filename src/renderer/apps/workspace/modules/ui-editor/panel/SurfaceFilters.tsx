import { Network } from "lucide-react";
import type { UISurfaceKind } from "@shared/types/ui-editor/document";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { useTranslation } from "@/lib/i18n";
import { SURFACE_KIND_OPTIONS } from "./constants";

type SurfaceFiltersProps = {
    kind: UISurfaceKind;
    onKindChange: (kind: UISurfaceKind) => void;
    /**
     * Opens the Blueprint Overview. It sits here, small, beside the switch between pages and Game
     * UIs, because the overview is grouped by exactly those - and because it is a way of reading
     * the project rather than something to do in it, so it does not earn a place among the buttons.
     */
    onOpenBlueprintOverview?: () => void;
};

export function SurfaceFilters({
    kind,
    onKindChange,
    onOpenBlueprintOverview,
}: SurfaceFiltersProps) {
    const { t } = useTranslation();
    return (
        <div className="px-2 pt-2 pb-1">
            <div className="flex items-center justify-between gap-2">
                <div className="truncate text-xs font-semibold text-fg-muted">{t("uiEditor.panel.interfaceType")}</div>
                {onOpenBlueprintOverview ? (
                    <ToolbarButton
                        size="xs"
                        onClick={onOpenBlueprintOverview}
                        data-tip={t("blueprint.overview.title")}
                        aria-label={t("blueprint.overview.title")}
                        data-blueprint-overview-open=""
                        className="-my-1 shrink-0"
                    >
                        <Network className="h-3.5 w-3.5" />
                    </ToolbarButton>
                ) : null}
            </div>
            <div className="mt-2 flex gap-2">
                {SURFACE_KIND_OPTIONS.map(option => (
                    <button
                        key={option.kind}
                        type="button"
                        className={`flex-1 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${
                            kind === option.kind
                                ? "border-primary bg-primary/10 text-fg"
                                : "border-edge text-fg-muted hover:bg-fill hover:text-fg"
                        }`}
                        onClick={() => onKindChange(option.kind)}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
