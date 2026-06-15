import type { UIStageSurfaceMount, UISurfaceKind } from "@shared/types/ui-editor/document";
import { STAGE_MOUNT_OPTIONS, SURFACE_KIND_OPTIONS } from "./constants";

type SurfaceFiltersProps = {
    kind: UISurfaceKind;
    stageMountFilter: UIStageSurfaceMount["kind"] | null;
    onKindChange: (kind: UISurfaceKind) => void;
    onStageMountFilterChange: (value: UIStageSurfaceMount["kind"] | null) => void;
};

export function SurfaceFilters({
    kind,
    stageMountFilter,
    onKindChange,
    onStageMountFilterChange,
}: SurfaceFiltersProps) {
    const handleMountToggle = (optionKind: UIStageSurfaceMount["kind"]) => {
        onStageMountFilterChange(stageMountFilter === optionKind ? null : optionKind);
    };

    return (
        <>
            <div className="px-2 pt-2 pb-1">
                <div className="text-xs font-semibold uppercase text-gray-400">Surface Type</div>
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

            {kind === "stageSurface" && (
                <div className="px-2 mt-2">
                    <div className="text-xs font-semibold uppercase text-gray-400">Stage Mount</div>
                    <div className="mt-2 flex gap-2">
                        <button
                            type="button"
                            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${
                                stageMountFilter === null
                                    ? "border-primary bg-primary/10 text-white"
                                    : "border-white/10 text-gray-300 hover:bg-white/10 hover:text-white"
                            }`}
                            onClick={() => onStageMountFilterChange(null)}
                        >
                            All
                        </button>
                        {STAGE_MOUNT_OPTIONS.map(option => (
                            <button
                                key={option.kind}
                                type="button"
                                className={`flex-1 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${
                                    stageMountFilter === option.kind
                                        ? "border-primary bg-primary/10 text-white"
                                        : "border-white/10 text-gray-300 hover:bg-white/10 hover:text-white"
                                }`}
                                onClick={() => handleMountToggle(option.kind)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
