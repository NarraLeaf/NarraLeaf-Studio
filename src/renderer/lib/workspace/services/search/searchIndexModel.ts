import type { StoryDocument } from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { LocalizationKeysDocument } from "@shared/types/localization";
import { getTextSegment } from "@/apps/workspace/modules/story/scene-editor/storySceneBlockUtils";
import { richRunsToPlain, segmentToRuns } from "@/apps/workspace/modules/story/scene-editor/richText";

/**
 * Global project search — the pure model.
 *
 * Extraction turns each searchable document into flat {@link SearchIndexEntry} lists; the service
 * owns *when* slices rebuild (change events), this file owns *what* is searchable and how a query
 * ranks against it. Content search wants substring matching (a fuzzy subsequence over prose surfaces
 * junk hits), so the matcher here is deliberately not `fuzzyListModel`: lowercase substring with
 * word-boundary and position bonuses, primary `text` before secondary `detail`.
 */

export type SearchGroup = "story" | "asset" | "variable" | "uiTextKey" | "blueprintNode";

/** Fixed presentation order of result groups. */
export const SEARCH_GROUP_ORDER: readonly SearchGroup[] = ["story", "asset", "variable", "uiTextKey", "blueprintNode"];

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

export interface SearchIndexEntry {
    /** Stable unique id (used as the React key of the result row). */
    id: string;
    group: SearchGroup;
    /** Primary searchable text — what the result row shows as its title. */
    text: string;
    /** Context line (also searched, at a lower weight): story › scene, blueprint name, source text… */
    detail?: string;
    target: SearchJumpTarget;
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
 * display titles ("blueprintNode"). Only blueprints reachable through an owner record are indexed —
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
                target: { kind: "asset" as const, assetId: asset.id, assetType: asset.type },
            };
        });
}

/** Named UI text keys: searchable by key name (title) and by source text (detail). */
export function extractLocalizationKeyEntries(document: LocalizationKeysDocument): SearchIndexEntry[] {
    return Object.entries(document.keys).map(([name, definition]) => ({
        id: `uikey:${name}`,
        group: "uiTextKey",
        text: name,
        detail: definition.sourceText || undefined,
        target: { kind: "localizationKey", keyName: name },
    }));
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export interface SearchHit {
    entry: SearchIndexEntry;
    score: number;
    /** Matched range in `entry.text` (for highlighting), or null when the hit was in `detail`. */
    titleRange: [start: number, end: number] | null;
}

export interface SearchGroupResult {
    group: SearchGroup;
    hits: SearchHit[];
    /** Total matches in the group before the per-group cap. */
    total: number;
}

function isWordBoundary(text: string, index: number): boolean {
    if (index === 0) {
        return true;
    }
    return !/[\p{L}\p{N}]/u.test(text[index - 1]);
}

/** Score a case-insensitive substring occurrence; higher is better, null when absent. */
function scoreSubstring(haystack: string, needle: string): { index: number; score: number } | null {
    const index = haystack.toLowerCase().indexOf(needle);
    if (index < 0) {
        return null;
    }
    let score = 100;
    if (index === 0) {
        score += 20;
    } else if (isWordBoundary(haystack, index)) {
        score += 10;
    }
    // Earlier and tighter matches read as more relevant.
    score -= Math.min(index, 20);
    score -= Math.min(Math.floor(haystack.length / 40), 10);
    return { index, score };
}

/**
 * Query the index: case-insensitive substring over `text` (primary) then `detail` (secondary,
 * down-weighted, no title highlight). Results come back grouped in {@link SEARCH_GROUP_ORDER},
 * best-first within each group, capped at `maxPerGroup` (with the uncapped `total` reported so the
 * UI can say "N more").
 */
export function querySearchIndex(
    entries: readonly SearchIndexEntry[],
    rawQuery: string,
    options?: { maxPerGroup?: number },
): SearchGroupResult[] {
    const query = rawQuery.trim().toLowerCase();
    if (!query) {
        return [];
    }
    const maxPerGroup = options?.maxPerGroup ?? 20;

    const byGroup = new Map<SearchGroup, SearchHit[]>();
    for (const entry of entries) {
        const titleMatch = scoreSubstring(entry.text, query);
        let hit: SearchHit | null = null;
        if (titleMatch) {
            hit = { entry, score: titleMatch.score, titleRange: [titleMatch.index, titleMatch.index + query.length] };
        } else if (entry.detail) {
            const detailMatch = scoreSubstring(entry.detail, query);
            if (detailMatch) {
                hit = { entry, score: detailMatch.score / 2, titleRange: null };
            }
        }
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
        results.push({ group, hits: hits.slice(0, maxPerGroup), total: hits.length });
    }
    return results;
}
