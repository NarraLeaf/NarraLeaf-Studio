import { listBlueprintNodePaletteEntries } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";

type Props = {
    onPickType: (type: string) => void;
};

export function BlueprintNodePalette({ onPickType }: Props) {
    const entries = listBlueprintNodePaletteEntries();
    return (
        <div className="flex flex-col gap-1 border-t border-white/10 pt-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Add node</p>
            <div className="flex flex-wrap gap-1.5">
                {entries.map(e => (
                    <button
                        key={e.type}
                        type="button"
                        className="rounded border border-white/10 bg-[#1a1d21] px-2 py-1 text-[11px] text-gray-200 hover:border-cyan-500/40 hover:bg-cyan-500/10"
                        onClick={() => onPickType(e.type)}
                        title={e.keywords?.join(", ")}
                    >
                        {e.displayName}
                    </button>
                ))}
            </div>
        </div>
    );
}
