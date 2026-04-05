type Props = {
    graphLabel: string;
    onDeleteSelectedNode?: () => void;
    canDelete: boolean;
};

export function BlueprintGraphToolbar({ graphLabel, onDeleteSelectedNode, canDelete }: Props) {
    return (
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#111315] px-3 py-2">
            <span className="text-xs font-medium text-gray-300 truncate">{graphLabel}</span>
            <button
                type="button"
                disabled={!canDelete}
                className="rounded border border-white/10 px-2 py-1 text-[11px] text-gray-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => onDeleteSelectedNode?.()}
            >
                Delete node
            </button>
        </div>
    );
}
