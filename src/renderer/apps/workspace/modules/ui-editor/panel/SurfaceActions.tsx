import { Plus } from "lucide-react";

type SurfaceActionsProps = {
    onCreate: () => void;
    createLabel: string;
    createDisabled: boolean;
};

export function SurfaceActions({
    onCreate,
    createLabel,
    createDisabled,
}: SurfaceActionsProps) {
    return (
        <div className="px-2 mt-2 space-y-1.5">
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={onCreate}
                    disabled={createDisabled}
                    className="flex-1 flex h-10 items-center justify-center gap-2 rounded-md border border-edge-strong bg-surface-sunken px-3 text-xs font-semibold text-fg transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-fill hover:text-fg"
                >
                    <Plus className="w-4 h-4" />
                    <span>{createLabel}</span>
                </button>
            </div>
        </div>
    );
}
