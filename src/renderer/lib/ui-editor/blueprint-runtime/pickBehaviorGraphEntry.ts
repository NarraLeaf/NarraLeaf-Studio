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
        throw new Error(`Graph "${graph.id}" has no entries`);
    }
    return entries[keys[0]];
}
