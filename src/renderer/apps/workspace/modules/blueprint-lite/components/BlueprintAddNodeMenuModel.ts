import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/blueprint-nodes/types";

export const BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID = "all";

export type BlueprintAddNodeCategory = {
    id: string;
    label: string;
    count: number;
};

export function buildBlueprintAddNodeCategories(
    entries: readonly BlueprintNodeEditorCatalogEntry[],
): BlueprintAddNodeCategory[] {
    const counts = new Map<string, number>();
    for (const entry of entries) {
        counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    }
    const categories = [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([category, count]) => ({ id: category, label: category, count }));
    return [
        { id: BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID, label: "All", count: entries.length },
        ...categories,
    ];
}

export function filterBlueprintAddNodeEntries(
    entries: readonly BlueprintNodeEditorCatalogEntry[],
    activeCategoryId: string,
    query: string,
): BlueprintNodeEditorCatalogEntry[] {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter(entry => {
        if (
            activeCategoryId !== BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID &&
            entry.category !== activeCategoryId
        ) {
            return false;
        }
        if (!normalizedQuery) {
            return true;
        }
        return (
            entry.displayName.toLowerCase().includes(normalizedQuery) ||
            entry.type.toLowerCase().includes(normalizedQuery) ||
            entry.category.toLowerCase().includes(normalizedQuery) ||
            Boolean(entry.keywords?.some(keyword => keyword.toLowerCase().includes(normalizedQuery)))
        );
    });
}
