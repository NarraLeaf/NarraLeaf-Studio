import { useTranslation } from "@/lib/i18n";
import { SURFACE_KIND_OPTIONS, surfaceKindOptionView, type SurfacePanelView } from "./constants";

type SurfaceFiltersProps = {
    view: SurfacePanelView;
    onViewChange: (view: SurfacePanelView) => void;
};

export function SurfaceFilters({
    view,
    onViewChange,
}: SurfaceFiltersProps) {
    const { t } = useTranslation();
    return (
        <div className="px-2 pt-2 pb-1">
            <div className="text-xs font-semibold text-fg-muted">{t("uiEditor.panel.interfaceType")}</div>
            <div className="mt-2 flex gap-2">
                {SURFACE_KIND_OPTIONS.map(option => surfaceKindOptionView(option)).map((optionView, index) => (
                    <button
                        key={optionView}
                        type="button"
                        className={`flex-1 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${
                            view === optionView
                                ? "border-primary bg-primary/10 text-fg"
                                : "border-edge text-fg-muted hover:bg-fill hover:text-fg"
                        }`}
                        onClick={() => onViewChange(optionView)}
                    >
                        {SURFACE_KIND_OPTIONS[index].label}
                    </button>
                ))}
            </div>
        </div>
    );
}
