import type { UISurfaceKind } from "@shared/types/ui-editor/document";
import { useTranslation } from "@/lib/i18n";
import { SURFACE_KIND_OPTIONS } from "./constants";

type SurfaceFiltersProps = {
    kind: UISurfaceKind;
    onKindChange: (kind: UISurfaceKind) => void;
};

/**
 * The switch between the project's pages and its Game UIs, at the top of the Interfaces section.
 *
 * The section's header names what the list holds, so the switch carries no label of its own on
 * screen; the group's name is what a screen reader announces for it.
 */
export function SurfaceFilters({ kind, onKindChange }: SurfaceFiltersProps) {
    const { t } = useTranslation();
    return (
        <div className="shrink-0 px-2 pt-2">
            <div className="flex gap-2" role="group" aria-label={t("uiEditor.panel.interfaceType")}>
                {SURFACE_KIND_OPTIONS.map(option => (
                    <button
                        key={option.kind}
                        type="button"
                        aria-pressed={kind === option.kind}
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
