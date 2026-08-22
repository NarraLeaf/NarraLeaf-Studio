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
    "App",
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

export function blueprintAddNodeEntryKey(entry: BlueprintNodeEditorCatalogEntry): string {
    const ref = entry.magicElementRef;
    if (!ref) {
        return entry.type;
    }
    return [
        entry.type,
        ref.sourceNodeId,
        ref.sourcePortId,
        ref.targetPortId,
        ref.surfaceId,
        ref.elementId,
    ].join("\0");
}

/**
 * Localizer for search matching. Lets the search consider the same translated
 * text the palette renders, so a user typing in their UI language finds nodes by
 * their localized title/category rather than only the original English strings.
 */
export type BlueprintAddNodeLocalizer = {
    title: (displayName: string) => string;
    category: (category: string) => string;
};

/**
 * One entry with every string it can be found by already folded, lowercased and split.
 *
 * The palette is ~300 entries wide and each carries half a dozen searchable strings, so scoring a
 * query used to `normalize("NFKD")` and re-split all of them on every keystroke - the same work, on
 * the same text, once per character typed. Folding it once per catalogue leaves a keystroke with
 * only the query itself to fold.
 */
export type PreparedBlueprintAddNodeEntry = {
    entry: BlueprintNodeEditorCatalogEntry;
    /** Catalogue order, kept so equal scores fall back to the order the palette lists. */
    index: number;
    fields: readonly PreparedSearchField[];
};

type PreparedSearchField = {
    normalized: string;
    compact: string;
    words: readonly string[];
    /** First letter of each word, for the `madd` -> `Math Add` match. */
    acronym: string;
    weight: number;
};

type PreparedQueryToken = {
    token: string;
    compact: string;
};

/** Fold every entry's searchable text once, for {@link filterPreparedBlueprintAddNodeEntries}. */
export function prepareBlueprintAddNodeEntries(
    entries: readonly BlueprintNodeEditorCatalogEntry[],
    localizer?: BlueprintAddNodeLocalizer,
): PreparedBlueprintAddNodeEntry[] {
    return entries.map((entry, index) => ({
        entry,
        index,
        fields: searchFieldsFor(entry, localizer).map(prepareSearchField),
    }));
}

export function filterPreparedBlueprintAddNodeEntries(
    prepared: readonly PreparedBlueprintAddNodeEntry[],
    activeCategoryId: string,
    query: string,
): BlueprintNodeEditorCatalogEntry[] {
    const inCategory = prepared.filter(
        item =>
            activeCategoryId === BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID ||
            item.entry.category === activeCategoryId,
    );

    const queryTokens = tokenizeSearchText(query).map<PreparedQueryToken>(token => ({
        token,
        compact: readSearchTextForms(token).compact,
    }));
    if (queryTokens.length === 0) {
        return inCategory.map(item => item.entry);
    }

    const scored: Array<{ entry: BlueprintNodeEditorCatalogEntry; index: number; score: number }> = [];
    for (const item of inCategory) {
        const score = scoreBlueprintAddNodeEntry(item, queryTokens);
        if (score !== null) {
            scored.push({ entry: item.entry, index: item.index, score });
        }
    }
    return scored
        .sort((a, b) => a.score - b.score || a.index - b.index)
        .map(item => item.entry);
}

/**
 * Fold and filter in one call.
 *
 * The menu keeps the two apart so the folded catalogue survives a keystroke; this is for callers
 * with a single question to ask.
 */
export function filterBlueprintAddNodeEntries(
    entries: readonly BlueprintNodeEditorCatalogEntry[],
    activeCategoryId: string,
    query: string,
    localizer?: BlueprintAddNodeLocalizer,
): BlueprintNodeEditorCatalogEntry[] {
    return filterPreparedBlueprintAddNodeEntries(
        prepareBlueprintAddNodeEntries(entries, localizer),
        activeCategoryId,
        query,
    );
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

function searchFieldsFor(
    entry: BlueprintNodeEditorCatalogEntry,
    localizer?: BlueprintAddNodeLocalizer,
): BlueprintAddNodeSearchField[] {
    const localizedTitle = localizer?.title(entry.displayName);
    const localizedCategory = localizer?.category(entry.category);
    return [
        { text: entry.displayName, weight: FIELD_WEIGHTS.displayName },
        ...(localizedTitle && localizedTitle !== entry.displayName
            ? [{ text: localizedTitle, weight: FIELD_WEIGHTS.displayName }]
            : []),
        ...(entry.magicElementRef
            ? [
                  { text: entry.magicElementRef.label, weight: FIELD_WEIGHTS.displayName + 2 },
                  { text: entry.magicElementRef.elementType, weight: FIELD_WEIGHTS.keyword },
              ]
            : []),
        { text: entry.type, weight: FIELD_WEIGHTS.type },
        { text: entry.category, weight: FIELD_WEIGHTS.category },
        ...(localizedCategory && localizedCategory !== entry.category
            ? [{ text: localizedCategory, weight: FIELD_WEIGHTS.category }]
            : []),
        ...(entry.keywords ?? []).map(keyword => ({ text: keyword, weight: FIELD_WEIGHTS.keyword })),
    ];
}

function prepareSearchField(field: BlueprintAddNodeSearchField): PreparedSearchField {
    const { normalized, compact, words } = readSearchTextForms(field.text);
    return {
        normalized,
        compact,
        words,
        acronym: words.map(word => word[0]).join(""),
        weight: field.weight,
    };
}

function scoreBlueprintAddNodeEntry(
    item: PreparedBlueprintAddNodeEntry,
    queryTokens: readonly PreparedQueryToken[],
): number | null {
    let totalScore = 0;
    for (const queryToken of queryTokens) {
        let bestScore: number | null = null;
        for (const field of item.fields) {
            const score = scoreSearchToken(field, queryToken);
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

function scoreSearchToken(field: PreparedSearchField, queryToken: PreparedQueryToken): number | null {
    const { token, compact: compactToken } = queryToken;
    if (!compactToken) {
        return null;
    }

    const { normalized: normalizedText, compact: compactText, words } = field;

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

    if (field.acronym.startsWith(compactToken)) {
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

/** Copied out of the cache: the caller owns its array, the cache keeps its own. */
function tokenizeSearchText(text: string): string[] {
    return [...readSearchTextForms(text).words];
}

/** The three shapes of one string the scorer compares against. */
type SearchTextForms = {
    normalized: string;
    compact: string;
    words: string[];
};

/**
 * How many strings the form cache holds before it starts over.
 *
 * The catalogue's own fields are a fixed set a few thousand strings wide; only what the author
 * types adds to it, and slowly. The cap is a backstop against a long session, not a working limit.
 */
const SEARCH_TEXT_FORM_LIMIT = 8192;
const searchTextForms = new Map<string, SearchTextForms>();

/**
 * Normalised forms of `text`, computed once per distinct string.
 *
 * Each keystroke in the palette scores every entry against ~10 fields, and each field was
 * NFKD-normalised, compacted and split from scratch every time — the same few thousand catalogue
 * strings, re-derived on every letter.
 */
function readSearchTextForms(text: string): SearchTextForms {
    const cached = searchTextForms.get(text);
    if (cached) {
        return cached;
    }
    const normalized = normalizeSearchText(text);
    const forms: SearchTextForms = {
        normalized,
        compact: normalized.replace(/[^\p{L}\p{N}]+/gu, ""),
        words: normalized.split(/[^\p{L}\p{N}]+/u).map(token => token.trim()).filter(Boolean),
    };
    if (searchTextForms.size >= SEARCH_TEXT_FORM_LIMIT) {
        searchTextForms.clear();
    }
    searchTextForms.set(text, forms);
    return forms;
}

function normalizeSearchText(text: string): string {
    return text
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

