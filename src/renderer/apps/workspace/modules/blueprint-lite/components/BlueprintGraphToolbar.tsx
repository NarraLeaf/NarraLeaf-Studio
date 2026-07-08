type Props = {
    graphLabel: string;
    onDeleteSelectedNode?: () => void;
    canDelete: boolean;
};

export function BlueprintGraphToolbar({ graphLabel, onDeleteSelectedNode, canDelete }: Props) {
    return null;

    // return (
    //     <div
    //         className="flex shrink-0 items-center justify-between gap-2 border-b border-edge bg-surface-sunken px-2 py-1.5"
    //         title="Right-click the canvas to add a node: a preview follows the cursor until you left-click to place (nothing is saved until then). Escape cancels the preview. Cyan = execution flow; amber = data wires. Select a wire and press Delete / Backspace, or double-click a wire to remove it. Literal values can be edited on the node or in Details."
    //     >
    //         <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg-muted">{graphLabel}</span>
    //         <button
    //             type="button"
    //             disabled={!canDelete}
    //             className="shrink-0 rounded border border-edge px-2 py-1 text-2xs text-fg-muted hover:bg-fill-subtle disabled:cursor-not-allowed disabled:opacity-40"
    //             onClick={() => onDeleteSelectedNode?.()}
    //         >
    //             Delete node
    //         </button>
    //     </div>
    // );
}
