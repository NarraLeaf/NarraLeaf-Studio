import type { UISurfaceKind } from "@shared/types/ui-editor/document";
import { SURFACE_KIND_OPTIONS } from "./constants";

type SurfaceFiltersProps = {
    kind: UISurfaceKind;
    onKindChange: (kind: UISurfaceKind) => void;
};

export function SurfaceFilters({
    kind,
    onKindChange,
}: SurfaceFiltersProps) {
    return (
        <div className="px-2 pt-2 pb-1">
            <div className="text-xs font-semibold text-gray-400">Interface Type</div>
            <div className="mt-2 flex gap-2">
                {SURFACE_KIND_OPTIONS.map(option => (
                    <button
                        key={option.kind}
                        type="button"
                        className={`flex-1 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${
                            kind === option.kind
                                ? "border-primary bg-primary/10 text-white"
                                : "border-white/10 text-gray-300 hover:bg-white/10 hover:text-white"
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
