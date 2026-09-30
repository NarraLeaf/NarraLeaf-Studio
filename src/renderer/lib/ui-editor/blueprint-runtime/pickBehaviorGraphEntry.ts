import type { UIGraph, UIGraphEntry } from "@shared/types/ui-editor/graph";

/**
 * Resolve which entry node to run. Prefer `main`, then `default`, else first key.
 */
export function pickBehaviorGraphEntry(graph: UIGraph): UIGraphEntry {
    const entries = graph.entries;
    if (entries.main) {
        return entries.main;
    }
    if (entries.default) {
        return entries.default;
    }
    const keys = Object.keys(entries);
    if (keys.length === 0) {
        // A caller mistake, never an author's: every graph the editor saves has an entry, and the one
        // caller (graph validation) catches this. English, and without the graph's id.
        throw new Error("The graph has no entries");
    }
    return entries[keys[0]];
}
