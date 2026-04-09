import { useMemo, useState } from "react";
import { listBlueprintNodePaletteEntries } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { Search } from "lucide-react";

type Props = {
    onPickType: (type: string) => void;
};

export function BlueprintNodePalette({ onPickType }: Props) {
    const entries = useMemo(() => listBlueprintNodePaletteEntries(), []);
    const [query, setQuery] = useState("");

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) {
            return entries;
        }
        return entries.filter(
            e =>
                e.displayName.toLowerCase().includes(q) ||
                e.type.toLowerCase().includes(q) ||
                e.category.toLowerCase().includes(q) ||
                e.keywords?.some(k => k.toLowerCase().includes(q)),
        );
    }, [entries, query]);

    const byCategory = useMemo(() => {
        const m = new Map<string, typeof filtered>();
        for (const e of filtered) {
            const list = m.get(e.category) ?? [];
            list.push(e);
            m.set(e.category, list);
        }
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [filtered]);

    return (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Add node</p>
            <p className="text-[10px] leading-snug text-gray-600">
                Palette adds nodes to the <span className="text-gray-400">active</span> event or function graph. Wire{" "}
                <span className="text-gray-400">exec</span> outputs into <span className="text-gray-400">In</span> inputs.
            </p>
            <EnhancedInput
                value={query}
                onChange={setQuery}
                placeholder="Filter by name, type, category…"
                leftIcon={<Search className="h-3.5 w-3.5 text-gray-500" />}
                className="w-full"
                inputClassName="text-[11px]"
            />
            <div className="max-h-48 space-y-2 overflow-y-auto pr-0.5">
                {byCategory.length === 0 ? (
                    <p className="text-[11px] text-gray-500">No nodes match.</p>
                ) : (
                    byCategory.map(([category, list]) => (
                        <div key={category}>
                            <p className="mb-1 text-[9px] uppercase tracking-wide text-gray-600">{category}</p>
                            <div className="flex flex-wrap gap-1.5">
                                {list.map(e => (
                                    <button
                                        key={e.type}
                                        type="button"
                                        className="rounded border border-white/10 bg-[#1a1d21] px-2 py-1 text-[11px] text-gray-200 hover:border-cyan-500/40 hover:bg-cyan-500/10"
                                        onClick={() => onPickType(e.type)}
                                        title={e.keywords?.join(", ") ?? e.type}
                                    >
                                        {e.displayName}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
