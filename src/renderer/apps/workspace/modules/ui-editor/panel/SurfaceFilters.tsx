import type { UISurfaceKind } from "@shared/types/ui-editor/document";
import { useTranslation } from "@/lib/i18n";
import { SURFACE_KIND_OPTIONS } from "./constants";

type SurfaceFiltersProps = {
    kind: UISurfaceKind;
    onKindChange: (kind: UISurfaceKind) => void;
};

export function SurfaceFilters({
    kind,
    onKindChange,
}: SurfaceFiltersProps) {
    const { t } = useTranslation();
    return (
        <div className="px-2 pt-2 pb-1">
            <div className="text-xs font-semibold text-fg-muted">{t("uiEditor.panel.interfaceType")}</div>
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
