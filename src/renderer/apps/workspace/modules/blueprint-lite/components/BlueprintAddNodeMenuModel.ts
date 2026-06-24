import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/blueprint-nodes/types";

export const BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID = "all";

export type BlueprintAddNodeCategory = {
    id: string;
    label: string;
    count: number;
};

const DOCUMENTED_CATEGORY_ORDER = [
    "Events",
    "Flow",
    "Element",
    "Displayable",
    "Page",
    "Variables",
    "Data",
    "Math",
    "Text",
    "Navigation",
    "Debug",
] as const;

function compareCategoryId(a: string, b: string): number {
    const ai = DOCUMENTED_CATEGORY_ORDER.indexOf(a as (typeof DOCUMENTED_CATEGORY_ORDER)[number]);
    const bi = DOCUMENTED_CATEGORY_ORDER.indexOf(b as (typeof DOCUMENTED_CATEGORY_ORDER)[number]);
    if (ai !== -1 || bi !== -1) {
        if (ai === -1) {
            return 1;
        }
        if (bi === -1) {
            return -1;
        }
        return ai - bi;
    }
    return a.localeCompare(b);
}

export function buildBlueprintAddNodeCategories(
    entries: readonly BlueprintNodeEditorCatalogEntry[],
): BlueprintAddNodeCategory[] {
    const counts = new Map<string, number>();
    for (const entry of entries) {
        counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    }
    const categories = [...counts.entries()]
        .sort((a, b) => compareCategoryId(a[0], b[0]))
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
    const queryTokens = tokenizeSearchText(query);
    const filtered = entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => {
            if (
                activeCategoryId !== BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID &&
                entry.category !== activeCategoryId
            ) {
                return false;
            }
            return true;
        });

    if (queryTokens.length === 0) {
        return filtered.map(item => item.entry);
    }

    return filtered
        .map(({ entry, index }) => {
            const score = scoreBlueprintAddNodeEntry(entry, queryTokens);
            return score === null ? null : { entry, index, score };
        })
        .filter((item): item is { entry: BlueprintNodeEditorCatalogEntry; index: number; score: number } =>
            item !== null
        )
        .sort((a, b) => a.score - b.score || a.index - b.index)
        .map(item => item.entry);
}

type BlueprintAddNodeSearchField = {
    text: string;
    weight: number;
};

const FIELD_WEIGHTS = {
    displayName: 0,
    type: 8,
    keyword: 12,
    category: 18,
} as const;

function scoreBlueprintAddNodeEntry(
    entry: BlueprintNodeEditorCatalogEntry,
    queryTokens: readonly string[],
): number | null {
    const fields: BlueprintAddNodeSearchField[] = [
        { text: entry.displayName, weight: FIELD_WEIGHTS.displayName },
        { text: entry.type, weight: FIELD_WEIGHTS.type },
        { text: entry.category, weight: FIELD_WEIGHTS.category },
        ...(entry.keywords ?? []).map(keyword => ({ text: keyword, weight: FIELD_WEIGHTS.keyword })),
    ];

    let totalScore = 0;
    for (const queryToken of queryTokens) {
        let bestScore: number | null = null;
        for (const field of fields) {
            const score = scoreSearchToken(field.text, queryToken);
            if (score === null) {
                continue;
            }
            const weightedScore = field.weight + score;
            bestScore = bestScore === null ? weightedScore : Math.min(bestScore, weightedScore);
        }
        if (bestScore === null) {
            return null;
        }
        totalScore += bestScore;
    }

    return totalScore;
}

function scoreSearchToken(text: string, rawToken: string): number | null {
    const token = normalizeSearchText(rawToken);
    const compactToken = compactSearchText(rawToken);
    if (!compactToken) {
        return null;
    }

    const normalizedText = normalizeSearchText(text);
    const compactText = compactSearchText(text);
    const words = tokenizeSearchText(text);

    if (normalizedText === token || compactText === compactToken) {
        return 0;
    }
    if (words.some(word => word === token)) {
        return 1;
    }
    if (normalizedText.startsWith(token)) {
        return 3;
    }
    const wordPrefixIndex = words.findIndex(word => word.startsWith(token));
    if (wordPrefixIndex >= 0) {
        return 5 + wordPrefixIndex;
    }
    const normalizedIndex = normalizedText.indexOf(token);
    if (normalizedIndex >= 0) {
        return 12 + normalizedIndex / 10;
    }
    if (compactText.startsWith(compactToken)) {
        return 16;
    }
    const compactIndex = compactText.indexOf(compactToken);
    if (compactIndex >= 0) {
        return 24 + compactIndex / 10;
    }

    const acronym = words.map(word => word[0]).join("");
    if (acronym.startsWith(compactToken)) {
        return 32;
    }

    const fuzzyScore = scoreFuzzySubsequence(compactText, compactToken);
    if (fuzzyScore === null) {
        return null;
    }
    const maxFuzzyScore = Math.max(4, compactToken.length * 1.4);
    return fuzzyScore <= maxFuzzyScore ? 48 + fuzzyScore : null;
}

function scoreFuzzySubsequence(text: string, token: string): number | null {
    let searchFrom = 0;
    let previousIndex = -1;
    let firstIndex = -1;
    let gapPenalty = 0;

    for (const char of token) {
        const index = text.indexOf(char, searchFrom);
        if (index < 0) {
            return null;
        }
        if (firstIndex < 0) {
            firstIndex = index;
        }
        if (previousIndex >= 0) {
            gapPenalty += Math.max(0, index - previousIndex - 1);
        }
        previousIndex = index;
        searchFrom = index + 1;
    }

    return firstIndex + gapPenalty / 2 + Math.max(0, text.length - token.length) / 20;
}

function tokenizeSearchText(text: string): string[] {
    return normalizeSearchText(text)
        .split(/[^\p{L}\p{N}]+/u)
        .map(token => token.trim())
        .filter(Boolean);
}

function normalizeSearchText(text: string): string {
    return text
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function compactSearchText(text: string): string {
    return normalizeSearchText(text).replace(/[^\p{L}\p{N}]+/gu, "");
}
