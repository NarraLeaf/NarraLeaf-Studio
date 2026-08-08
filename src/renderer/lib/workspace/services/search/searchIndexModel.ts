import type { SearchJumpTarget } from "./searchJumpTarget";
import type { CompiledMatcher } from "./textMatcher";

/**
 * Global project search - the pure query model.
 *
 * This file owns *what an entry is* and *how a query ranks against it*, and nothing else. Where the
 * entries come from is a source's business (`sources/*.ts`, declared in `searchSources.ts`) and *when*
 * they are rebuilt is the service's (`SearchService.ts`). Nothing here imports a workspace service, a
 * document type, or an extractor - which is what lets the scorer be read, reasoned about and profiled
 * on its own.
 *
 * Two deliberate departures from the other matchers in the codebase:
 *
 *  - **Substring, not fuzzy.** Content search wants substring matching - a fuzzy subsequence over
 *    prose surfaces junk hits - so this is not `fuzzyListModel`. Entity *names* are the opposite
 *    case and belong to quick-open's fuzzy matcher; keeping the two matchers apart is what keeps
 *    "find the line I wrote" and "open the thing called X" from polluting each other.
 *  - **Case-folded haystacks are precomputed.** {@link indexEntries} folds every searchable string
 *    once at extraction time. The alternative - folding inside the scorer - allocates one string per
 *    entry per keystroke, which at VN scale (tens of thousands of lines) is the dominant cost of a
 *    query.
 *
 * A query is AND over whitespace-separated terms, so word order never matters; `"…"` quotes a
 * phrase, and `key:value` pairs narrow by facet. Terms match three haystacks at descending weight:
 * `text` (the result title), `detail` (the context line), and `aux` (searchable but never shown -
 * tags, object names, translations).
 *
 * **Entities are indexed here too, and they sort first.** Content search and navigation used to be
 * strictly separate surfaces - names to quick open, prose to this index - and the split failed the
 * most basic expectation there is: typing a scene's name returned the lines inside that scene and
 * not the scene. One box the author types into has to answer "the thing called X" as well as
 * "the line that says X", so the entity groups lead {@link SEARCH_GROUP_ORDER}. The *matchers* stay
 * apart, which is what that split was really protecting: quick open still ranks names with
 * `fuzzyListModel`, and nothing fuzzy ever runs over prose.
 */

export type SearchGroup =
    // Entities - "open the thing called X".
    | "scene"
    | "story"
    | "character"
    | "uiSurface"
    | "blueprint"
    | "asset"
    // Content - "find the line I wrote".
    | "storyText"
    | "variable"
    | "uiTextKey"
    | "blueprintNode";

/** Fixed presentation order of result groups: entities first, then content. */
export const SEARCH_GROUP_ORDER: readonly SearchGroup[] = [
    "scene",
    "story",
    "character",
    "uiSurface",
    "blueprint",
    "asset",
    "storyText",
    "variable",
    "uiTextKey",
    "blueprintNode",
];

const GROUP_SET: ReadonlySet<string> = new Set(SEARCH_GROUP_ORDER);

/**
 * Re-exported so the four consumers outside search (`@/plugin`, lint, testing, references) keep their
 * import path. The declaration itself lives in `./searchJumpTarget` - see the note there.
 */
export type { SearchJumpTarget };

/**
 * Structured facets carried alongside the free text. These exist so narrowing never has to be
 * expressed as more text to match: UI chips filter on the id fields, `key:value` query syntax
 * filters on the name fields.
 */
export interface SearchEntryFields {
    storyId?: string;
    storyName?: string;
    sceneId?: string;
    sceneName?: string;
    /** Asset type discriminator (`image`, `audio`…), mirroring `AssetType`. */
    assetType?: string;
    /** Dialogue speaker display name - a Studio character's name, or a bare typed speaker. */
    speaker?: string;
    /**
     * Shared identity across text, translation, and voice (see `@shared/types/voice`). Carrying it
     * on the entry is what lets a translation or a voice take be joined onto the source line rather
     * than indexed as an entry of its own.
     */
    textId?: string;
}

/** An entry as authored by a source's extractor. */
export interface SearchIndexEntry {
    /** Stable unique id (used as the React key of the result row). */
    id: string;
    group: SearchGroup;
    /** Primary searchable text - what the result row shows as its title. */
    text: string;
    /** Context line (also searched, at a lower weight): story › scene, blueprint name, source text… */
    detail?: string;
    /**
     * Searchable but never rendered: tags, stage object names, translations. Lets an entry be found
     * by text that would only be noise in the result row.
     */
    aux?: string;
    fields?: SearchEntryFields;
    /**
     * How many indistinguishable things this row stands for (absent or 1 = just itself).
     *
     * Set by the framework's dedup pass, from the `dedupKey` a source declares. A graph holding eight
     * `Set Image Asset` nodes with nothing to tell them apart produced eight identical rows; one row
     * that says there are eight is the honest rendering of the same fact, and the only one the author
     * can act on. The jump goes to the first of them - which is also all a picker could have offered,
     * since the eight were indistinguishable in the list by construction.
     */
    count?: number;
    target: SearchJumpTarget;
}

/**
 * A query-ready entry: the authored entry plus its case-folded haystacks.
 *
 * `*Foldable` records whether folding preserved length. Unicode case folding can change a string's
 * length (`İ` folds to two code units), which would desync a match index found in the folded string
 * from the original text it highlights - so when folding is not length-preserving the entry still
 * matches but reports no highlight range rather than a wrong one.
 */
export interface IndexedSearchEntry extends SearchIndexEntry {
    textLower: string;
    detailLower?: string;
    auxLower?: string;
    /** False when `textLower` cannot be index-mapped back onto `text` (see above). */
    textFoldable: boolean;
}

/** Fold an authored entry list into query-ready entries. Call once per slice rebuild, never per query. */
export function indexEntries(entries: readonly SearchIndexEntry[]): IndexedSearchEntry[] {
    return entries.map(entry => {
        const textLower = entry.text.toLowerCase();
        return {
            ...entry,
            textLower,
            textFoldable: textLower.length === entry.text.length,
            ...(entry.detail ? { detailLower: entry.detail.toLowerCase() } : {}),
            ...(entry.aux ? { auxLower: entry.aux.toLowerCase() } : {}),
        };
    });
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

/** Where a term was found. Surfaced so a result that matched invisible text can explain itself. */
export type SearchMatchField = "text" | "detail" | "aux";

/**
 * Facet constraints. Id constraints come from UI chips (exact match on a picked entity); name
 * constraints come from `key:value` query syntax (substring, because people type names, not ids).
 */
export interface SearchFilters {
    groups?: readonly SearchGroup[];
    storyIds?: readonly string[];
    sceneIds?: readonly string[];
    assetTypes?: readonly string[];
    storyName?: string;
    sceneName?: string;
    speaker?: string;
}

export interface ParsedSearchQuery {
    /** Case-folded terms, ANDed. A quoted phrase is one term. */
    terms: string[];
    /** Facets parsed out of `key:value` pairs. */
    filters: SearchFilters;
    /**
     * The same free text, minus the facets, **as the author typed it** - the form a matcher needs.
     *
     * `terms` is case-folded and split, which is exactly right for the index and exactly wrong for
     * `Aa` and `.*`: one loses the case the author is asking to match, the other loses the pattern.
     * Tokens rejoin with a single space, so `find me` reads as the phrase a find bar would look for
     * rather than as two independent terms.
     */
    text: string;
}

/** `key:value` prefixes recognised in the query. Anything else stays literal text (so URLs survive). */
const FILTER_KEYS = new Set(["type", "group", "story", "scene", "speaker", "asset"]);

/** Split on whitespace, keeping `"quoted phrases"` together. */
function tokenizeQuery(raw: string): string[] {
    const tokens: string[] = [];
    const pattern = /"([^"]*)"|(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw)) !== null) {
        const token = match[1] !== undefined ? match[1] : match[2];
        if (token) {
            tokens.push(token);
        }
    }
    return tokens;
}

/**
 * Parse raw input into terms plus facets. `type:`/`group:` narrow to result groups; `story:`,
 * `scene:` and `speaker:` narrow by name; `asset:` narrows by asset type. An unknown prefix is not
 * a facet - the token stays a literal search term, which is what keeps `http://…` searchable.
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
    const terms: string[] = [];
    // Every token that stayed literal, in the case it was typed - see `ParsedSearchQuery.text`.
    const literals: string[] = [];
    const groups: SearchGroup[] = [];
    const assetTypes: string[] = [];
    const filters: SearchFilters = {};

    for (const token of tokenizeQuery(raw)) {
        const separator = token.indexOf(":");
        const key = separator > 0 ? token.slice(0, separator).toLowerCase() : "";
        const value = separator > 0 ? token.slice(separator + 1) : "";
        if (!key || !value || !FILTER_KEYS.has(key)) {
            terms.push(token.toLowerCase());
            literals.push(token);
            continue;
        }
        switch (key) {
            case "type":
            case "group": {
                const candidate = value.toLowerCase();
                const group = SEARCH_GROUP_ORDER.find(name => name.toLowerCase() === candidate);
                if (group) {
                    groups.push(group);
                } else {
                    terms.push(token.toLowerCase());
                    literals.push(token);
                }
                break;
            }
            case "asset":
                assetTypes.push(value.toLowerCase());
                break;
            case "story":
                filters.storyName = value.toLowerCase();
                break;
            case "scene":
                filters.sceneName = value.toLowerCase();
                break;
            case "speaker":
                filters.speaker = value.toLowerCase();
                break;
        }
    }

    if (groups.length > 0) {
        filters.groups = groups;
    }
    if (assetTypes.length > 0) {
        filters.assetTypes = assetTypes;
    }
    return { terms, filters, text: literals.join(" ") };
}

/** Merge query-syntax facets with UI-supplied ones; both must hold (intersection semantics). */
function mergeFilters(parsed: SearchFilters, supplied?: SearchFilters): SearchFilters {
    if (!supplied) {
        return parsed;
    }
    const intersectGroups = parsed.groups && supplied.groups
        ? parsed.groups.filter(group => supplied.groups!.includes(group))
        : parsed.groups ?? supplied.groups;
    return {
        ...supplied,
        ...parsed,
        ...(intersectGroups ? { groups: intersectGroups } : {}),
        storyIds: supplied.storyIds,
        sceneIds: supplied.sceneIds,
        assetTypes: parsed.assetTypes ?? supplied.assetTypes,
    };
}

/**
 * Whether an entry survives a facet narrowing. Exported so a caller that walks the index itself -
 * project replace enumerates its own candidates, uncapped - narrows by exactly the rule the query
 * path narrows by, rather than by a second reading of what `scene:` means.
 */
export function passesFilters(entry: IndexedSearchEntry, filters: SearchFilters): boolean {
    if (filters.groups && !filters.groups.includes(entry.group)) {
        return false;
    }
    const fields = entry.fields;
    if (filters.storyIds && !(fields?.storyId && filters.storyIds.includes(fields.storyId))) {
        return false;
    }
    if (filters.sceneIds && !(fields?.sceneId && filters.sceneIds.includes(fields.sceneId))) {
        return false;
    }
    if (filters.assetTypes && !(fields?.assetType && filters.assetTypes.includes(fields.assetType.toLowerCase()))) {
        return false;
    }
    if (filters.storyName && !fields?.storyName?.toLowerCase().includes(filters.storyName)) {
        return false;
    }
    if (filters.sceneName && !fields?.sceneName?.toLowerCase().includes(filters.sceneName)) {
        return false;
    }
    if (filters.speaker && !fields?.speaker?.toLowerCase().includes(filters.speaker)) {
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export interface SearchHit {
    entry: IndexedSearchEntry;
    score: number;
    /**
     * Matched ranges in `entry.text`, sorted and non-overlapping. Empty when the entry matched only
     * through `detail`/`aux` (or when folding was not index-safe) - see {@link IndexedSearchEntry}.
     */
    titleRanges: Array<[start: number, end: number]>;
    /** Weakest field any term relied on, so the row can explain a match the title does not show. */
    matchReason: SearchMatchField;
}

export interface SearchGroupResult {
    group: SearchGroup;
    hits: SearchHit[];
    /** Total matches in the group before the per-group cap. */
    total: number;
}

export interface SearchQueryOptions {
    maxPerGroup?: number;
    /** Groups the user expanded - capped far higher, but still capped (the list is rendered eagerly). */
    expandedGroups?: readonly SearchGroup[];
    filters?: SearchFilters;
    /**
     * Refined matching for the whole query - case, whole word, regular expression - replacing the
     * term path for as long as it is present.
     *
     * **Opt-in, and absent by default.** With none of the three options switched on, this is
     * `undefined` and every line below runs exactly as it did before the option existed: the folded
     * haystacks are what make a keystroke cheap over tens of thousands of entries, and a matcher
     * cannot use them (it reads the original text, so its offsets stay valid for a replacement).
     * Paying that per keystroke for a feature nobody switched on is the one thing this must not do.
     *
     * A matcher is compiled once per (query, options) change by whoever owns the input; passing a
     * freshly compiled one per query would put a `RegExp` construction on the keystroke path.
     */
    matcher?: CompiledMatcher;
}

const DEFAULT_MAX_PER_GROUP = 20;
const EXPANDED_MAX_PER_GROUP = 500;

function isWordBoundary(text: string, index: number): boolean {
    if (index === 0) {
        return true;
    }
    return !/[\p{L}\p{N}]/u.test(text[index - 1]);
}

/** Score a case-folded substring occurrence; higher is better, null when absent. */
function scoreSubstring(haystackLower: string, needle: string): { index: number; score: number } | null {
    const index = haystackLower.indexOf(needle);
    if (index < 0) {
        return null;
    }
    let score = 100;
    if (index === 0) {
        score += 20;
    } else if (isWordBoundary(haystackLower, index)) {
        score += 10;
    }
    // Earlier and tighter matches read as more relevant.
    score -= Math.min(index, 20);
    score -= Math.min(Math.floor(haystackLower.length / 40), 10);
    return { index, score };
}

/** Field weights: the title carries a match at full value, context and hidden text at half. */
const DETAIL_WEIGHT = 0.5;
const AUX_WEIGHT = 0.5;

/** Merge overlapping/adjacent ranges so highlighting never double-wraps a character. */
function normalizeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
    if (ranges.length <= 1) {
        return ranges;
    }
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [sorted[0]];
    for (const [start, end] of sorted.slice(1)) {
        const last = merged[merged.length - 1];
        if (start <= last[1]) {
            last[1] = Math.max(last[1], end);
        } else {
            merged.push([start, end]);
        }
    }
    return merged;
}

/**
 * Match one entry against every term (AND). Returns null as soon as a term is missing from all
 * three haystacks - the common case for most of the index, so it is the hot path.
 */
function matchEntry(entry: IndexedSearchEntry, terms: readonly string[]): SearchHit | null {
    let score = 0;
    const ranges: Array<[number, number]> = [];
    let sawDetail = false;
    let sawAux = false;

    for (const term of terms) {
        const inText = scoreSubstring(entry.textLower, term);
        const inDetail = entry.detailLower ? scoreSubstring(entry.detailLower, term) : null;
        const inAux = entry.auxLower ? scoreSubstring(entry.auxLower, term) : null;

        const textScore = inText ? inText.score : -1;
        const detailScore = inDetail ? inDetail.score * DETAIL_WEIGHT : -1;
        const auxScore = inAux ? inAux.score * AUX_WEIGHT : -1;
        const best = Math.max(textScore, detailScore, auxScore);
        if (best < 0) {
            return null;
        }
        score += best;

        if (inText) {
            if (entry.textFoldable) {
                ranges.push([inText.index, inText.index + term.length]);
            }
        } else if (inDetail) {
            sawDetail = true;
        } else {
            sawAux = true;
        }
    }

    return {
        entry,
        score,
        titleRanges: normalizeRanges(ranges),
        matchReason: sawAux ? "aux" : sawDetail ? "detail" : "text",
    };
}

/**
 * Match one entry with a compiled matcher instead of the term path.
 *
 * Scored on the same three fields at the same weights, but from one pattern rather than an AND of
 * terms, so `.*` and `Aa` mean the same thing here that they mean in the scene find bar. Ranges come
 * straight from the matcher: it read the original `text`, so its offsets highlight and splice
 * correctly with no foldability question to ask.
 */
function matchEntryWith(entry: IndexedSearchEntry, matcher: CompiledMatcher): SearchHit | null {
    const hits = matcher.findRanges(entry.text);
    if (hits.length > 0) {
        const first = hits[0].start;
        let score = 100;
        if (first === 0) {
            score += 20;
        } else if (isWordBoundary(entry.text, first)) {
            score += 10;
        }
        score -= Math.min(first, 20);
        score -= Math.min(Math.floor(entry.text.length / 40), 10);
        return {
            entry,
            score,
            titleRanges: normalizeRanges(hits.map(range => [range.start, range.end] as [number, number])),
            matchReason: "text",
        };
    }
    if (entry.detail && matcher.test(entry.detail)) {
        return { entry, score: 100 * DETAIL_WEIGHT, titleRanges: [], matchReason: "detail" };
    }
    if (entry.aux && matcher.test(entry.aux)) {
        return { entry, score: 100 * AUX_WEIGHT, titleRanges: [], matchReason: "aux" };
    }
    return null;
}

/**
 * Query the index. Terms are ANDed across `text`/`detail`/`aux`; facets narrow before scoring.
 * Results come back grouped in {@link SEARCH_GROUP_ORDER}, best-first within each group, capped per
 * group (with the uncapped `total` reported so the UI can offer "show all").
 */
export function querySearchIndex(
    entries: readonly IndexedSearchEntry[],
    rawQuery: string,
    options?: SearchQueryOptions,
): SearchGroupResult[] {
    const parsed = parseSearchQuery(rawQuery);
    const filters = mergeFilters(parsed.filters, options?.filters);
    // A facet-only query (`type:asset` with no terms) is not a search - it would return the whole
    // slice, which is a browse view's job, not this panel's.
    if (parsed.terms.length === 0) {
        return [];
    }

    const maxPerGroup = options?.maxPerGroup ?? DEFAULT_MAX_PER_GROUP;
    const expanded = options?.expandedGroups;
    const matcher = options?.matcher;

    const byGroup = new Map<SearchGroup, SearchHit[]>();
    for (const entry of entries) {
        if (!passesFilters(entry, filters)) {
            continue;
        }
        const hit = matcher ? matchEntryWith(entry, matcher) : matchEntry(entry, parsed.terms);
        if (!hit) {
            continue;
        }
        const bucket = byGroup.get(entry.group);
        if (bucket) {
            bucket.push(hit);
        } else {
            byGroup.set(entry.group, [hit]);
        }
    }

    const results: SearchGroupResult[] = [];
    for (const group of SEARCH_GROUP_ORDER) {
        const hits = byGroup.get(group);
        if (!hits || hits.length === 0) {
            continue;
        }
        hits.sort((a, b) => b.score - a.score);
        const cap = expanded?.includes(group) ? EXPANDED_MAX_PER_GROUP : maxPerGroup;
        results.push({ group, hits: hits.slice(0, cap), total: hits.length });
    }
    return results;
}

/** True when `group` has more matches than are being shown and can be expanded further. */
export function canExpandGroup(result: SearchGroupResult): boolean {
    return result.total > result.hits.length;
}

/** Group ids present in a result set, for driving filter chips. */
export function resultGroups(results: readonly SearchGroupResult[]): SearchGroup[] {
    return results.map(result => result.group).filter(group => GROUP_SET.has(group));
}
