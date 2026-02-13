import { Link, Plus } from "lucide-react";

type SurfaceActionsProps = {
    onCreate: () => void;
    onLink: () => void;
    createDisabled: boolean;
    linkDisabled: boolean;
    showLinkButton: boolean;
    linkTitle: string;
};

export function SurfaceActions({
    onCreate,
    onLink,
    createDisabled,
    linkDisabled,
    showLinkButton,
    linkTitle,
}: SurfaceActionsProps) {
    return (
        <div className="px-2 mt-2">
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={onCreate}
                    disabled={createDisabled}
                    className="flex-1 flex h-10 items-center justify-center gap-2 rounded-md border border-white/20 bg-[#0b0d12] px-3 text-xs font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10 hover:text-white"
                >
                    <Plus className="w-4 h-4" />
                    <span>Create Surface</span>
                </button>
                {showLinkButton && (
                    <button
                        type="button"
                        onClick={onLink}
                        disabled={linkDisabled}
                        title={linkTitle}
                        aria-label="Link App Surface"
                        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-white/20 bg-[#0b0d12] text-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10"
                    >
                        <Link className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    );
}
