import type { StoryDocument } from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { LocalizationKeysDocument } from "@shared/types/localization";
import { getTextSegment } from "@/apps/workspace/modules/story/scene-editor/storySceneBlockUtils";
import { richRunsToPlain, segmentToRuns } from "@/apps/workspace/modules/story/scene-editor/richText";

/**
 * Global project search - the pure model.
 *
 * Extraction turns each searchable document into flat {@link SearchIndexEntry} lists; the service
 * owns *when* slices rebuild (change events), this file owns *what* is searchable and how a query
 * ranks against it.
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
 */

export type SearchGroup = "story" | "asset" | "variable" | "uiTextKey" | "blueprintNode";

/** Fixed presentation order of result groups. */
export const SEARCH_GROUP_ORDER: readonly SearchGroup[] = ["story", "asset", "variable", "uiTextKey", "blueprintNode"];

const GROUP_SET: ReadonlySet<string> = new Set(SEARCH_GROUP_ORDER);

export type SearchJumpTarget =
    | { kind: "storyBlock"; storyId: string; sceneId: string; blockId: string; storyName: string; sceneName: string }
    | { kind: "storyScene"; storyId: string; sceneId: string; storyName: string; sceneName: string }
    | { kind: "asset"; assetId: string; assetType: string }
    | {
          kind: "blueprint";
          blueprintId: string;
          /** Owner slot key (e.g. `surfaceMain:<id>`); parsed into an editor open target at jump time. */
          ownerKey: string;
          focusEventId?: string;
          focusFunctionId?: string;
          focusNodeId?: string;
      }
    | { kind: "localizationKey"; keyName: string };

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

/** An entry as authored by an extractor. */
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
// Extraction
// ---------------------------------------------------------------------------

/**
 * Story slice: every block's prose (dialogue/narration/choice/note text) plus the story's
 * scene/saved variable names. Blocks land in "story"; variable definitions land in "variable".
 */
export function extractStoryEntries(document: StoryDocument): SearchIndexEntry[] {
    const entries: SearchIndexEntry[] = [];
    const storyName = document.name;

    for (const scene of Object.values(document.scenes)) {
        const context = `${storyName} › ${scene.name}`;
        const sceneFields: SearchEntryFields = {
            storyId: document.id,
            storyName,
            sceneId: scene.id,
            sceneName: scene.name,
        };

        for (const block of Object.values(scene.blocks)) {
            const segment = getTextSegment(block);
            if (!segment) {
                continue;
            }
            const text = richRunsToPlain(segmentToRuns(segment)).trim();
            if (!text) {
                continue;
            }
            entries.push({
                id: `story:${document.id}:${scene.id}:${block.id}`,
                group: "story",
                text,
                detail: context,
                fields: { ...sceneFields, ...(segment.textId ? { textId: segment.textId } : {}) },
                target: {
                    kind: "storyBlock",
                    storyId: document.id,
                    sceneId: scene.id,
                    blockId: block.id,
                    storyName,
                    sceneName: scene.name,
                },
            });
        }

        for (const definition of Object.values(scene.sceneVariables ?? {})) {
            if (!definition.name) {
                continue;
            }
            entries.push({
                id: `storyvar:${document.id}:${scene.id}:${definition.id}`,
                group: "variable",
                text: definition.name,
                detail: context,
                fields: sceneFields,
                target: {
                    kind: "storyScene",
                    storyId: document.id,
                    sceneId: scene.id,
                    storyName,
                    sceneName: scene.name,
                },
            });
        }
    }

    // Saved variables are document-level; jump to the entry scene (or the first scene) as the
    // closest editing surface.
    const fallbackSceneId = document.entrySceneId ?? Object.keys(document.scenes)[0];
    if (fallbackSceneId) {
        const fallbackScene = document.scenes[fallbackSceneId];
        for (const [variableId, definition] of Object.entries(document.savedVariables ?? {})) {
            if (!definition.name) {
                continue;
            }
            entries.push({
                id: `storyvar:${document.id}:saved:${variableId}`,
                group: "variable",
                text: definition.name,
                detail: storyName,
                fields: { storyId: document.id, storyName },
                target: {
                    kind: "storyScene",
                    storyId: document.id,
                    sceneId: fallbackSceneId,
                    storyName,
                    sceneName: fallbackScene?.name ?? "",
                },
            });
        }
    }

    return entries;
}

/**
 * Blueprint slice: member variable names + persistent variable names ("variable") and graph node
 * display titles ("blueprintNode"). Only blueprints reachable through an owner record are indexed -
 * an unowned blueprint has no editor surface to jump to.
 */
export function extractBlueprintEntries(
    document: BlueprintDocument,
    resolveNodeLabel: (nodeType: string) => string | undefined,
): SearchIndexEntry[] {
    const entries: SearchIndexEntry[] = [];

    // blueprintId → ownerKey (active blueprint first so it wins over historical siblings).
    const ownerKeyByBlueprintId = new Map<string, string>();
    for (const [ownerKey, record] of Object.entries(document.ownerRecords)) {
        for (const blueprintId of [record.activeBlueprintId, ...record.privateBlueprintIds]) {
            if (blueprintId && !ownerKeyByBlueprintId.has(blueprintId)) {
                ownerKeyByBlueprintId.set(blueprintId, ownerKey);
            }
        }
    }

    // Persistent variables are project-level, authored on the global blueprint when one exists.
    const globalRecord = document.ownerRecords["globalMain"];
    if (globalRecord) {
        for (const [variableId, definition] of Object.entries(document.persistentVariables)) {
            if (!definition.name) {
                continue;
            }
            entries.push({
                id: `bpvar:persistent:${variableId}`,
                group: "variable",
                text: definition.name,
                target: {
                    kind: "blueprint",
                    blueprintId: globalRecord.activeBlueprintId,
                    ownerKey: "globalMain",
                },
            });
        }
    }

    for (const blueprint of Object.values(document.blueprints)) {
        const ownerKey = ownerKeyByBlueprintId.get(blueprint.id);
        if (!ownerKey) {
            continue;
        }

        for (const variable of Object.values(blueprint.members?.variables ?? {})) {
            if (!variable.name) {
                continue;
            }
            entries.push({
                id: `bpvar:${blueprint.id}:${variable.id}`,
                group: "variable",
                text: variable.name,
                detail: blueprint.name,
                target: { kind: "blueprint", blueprintId: blueprint.id, ownerKey },
            });
        }

        if (blueprint.program.kind !== "graph") {
            continue;
        }
        const graphSlots: Array<{ focus: "event" | "function"; graphId: string; ir: { nodes?: Record<string, { id: string; type: string }> } | undefined }> = [
            ...Object.entries(blueprint.program.graphs.events).map(([graphId, slot]) => ({
                focus: "event" as const,
                graphId,
                ir: slot.graph,
            })),
            ...Object.entries(blueprint.program.graphs.functions).map(([graphId, slot]) => ({
                focus: "function" as const,
                graphId,
                ir: slot.graph,
            })),
        ];

        for (const { focus, graphId, ir } of graphSlots) {
            for (const node of Object.values(ir?.nodes ?? {})) {
                const label = resolveNodeLabel(node.type) ?? node.type;
                if (!label) {
                    continue;
                }
                entries.push({
                    id: `bpnode:${blueprint.id}:${graphId}:${node.id}`,
                    group: "blueprintNode",
                    text: label,
                    detail: blueprint.name,
                    target: {
                        kind: "blueprint",
                        blueprintId: blueprint.id,
                        ownerKey,
                        focusNodeId: node.id,
                        ...(focus === "event" ? { focusEventId: graphId } : { focusFunctionId: graphId }),
                    },
                });
            }
        }
    }

    return entries;
}

/** The slice of an asset the index needs; matches `Asset` structurally without importing it. */
export interface SearchableAsset {
    id: string;
    type: string;
    name: string;
    tags?: readonly string[];
    description?: string;
}

/**
 * Asset slice: every imported asset (images, audio, video, fonts…) searchable by name (title) and
 * by tags/description (detail). The type rides on the target so the jump can pick the right
 * affordance (preview tab vs. panel selection).
 */
export function extractAssetEntries(assets: readonly SearchableAsset[]): SearchIndexEntry[] {
    return assets
        .filter(asset => asset.name)
        .map(asset => {
            const detailParts = [...(asset.tags ?? [])];
            if (asset.description) {
                detailParts.push(asset.description);
            }
            return {
                id: `asset:${asset.id}`,
                group: "asset" as const,
                text: asset.name,
                detail: detailParts.length > 0 ? detailParts.join(", ") : undefined,
                fields: { assetType: asset.type },
                target: { kind: "asset" as const, assetId: asset.id, assetType: asset.type },
            };
        });
}

/** Named UI text keys: searchable by key name (title) and by source text (detail). */
export function extractLocalizationKeyEntries(document: LocalizationKeysDocument): SearchIndexEntry[] {
    return Object.entries(document.keys).map(([name, definition]) => ({
        id: `uikey:${name}`,
        group: "uiTextKey" as const,
        text: name,
        detail: definition.sourceText || undefined,
        target: { kind: "localizationKey" as const, keyName: name },
    }));
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
    const groups: SearchGroup[] = [];
    const assetTypes: string[] = [];
    const filters: SearchFilters = {};

    for (const token of tokenizeQuery(raw)) {
        const separator = token.indexOf(":");
        const key = separator > 0 ? token.slice(0, separator).toLowerCase() : "";
        const value = separator > 0 ? token.slice(separator + 1) : "";
        if (!key || !value || !FILTER_KEYS.has(key)) {
            terms.push(token.toLowerCase());
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
    return { terms, filters };
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

function passesFilters(entry: IndexedSearchEntry, filters: SearchFilters): boolean {
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

    const byGroup = new Map<SearchGroup, SearchHit[]>();
    for (const entry of entries) {
        if (!passesFilters(entry, filters)) {
            continue;
        }
        const hit = matchEntry(entry, parsed.terms);
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
