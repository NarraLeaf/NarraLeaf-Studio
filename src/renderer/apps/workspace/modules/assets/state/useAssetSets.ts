import { useCallback, useEffect, useMemo, useState } from "react";
import {
    resolveAssetSetContents,
    topLevelAssetSets,
    validateAssetSet,
    type AssetSet,
    type AssetSetCandidate,
    type AssetSetContents,
    type AssetSetProblem,
} from "@shared/types/assetSet";
import { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import { ASSET_CATEGORY_ORDER, AssetCategory, categoryOfAssetType, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
import { Services, WorkspaceContext } from "@/lib/workspace/services/services";
import { createEmptyAssetCategoryRecord } from "./assetCategoryRecord";

/**
 * One set, measured against the library the panel is currently showing.
 *
 * The measurement rides with the set rather than being asked for per row, because every surface
 * wants it at once: the tile tints on it, the count comes off it, and the inspector draws it.
 */
export interface ResolvedAssetSet {
    set: AssetSet;
    category: AssetCategory;
    contents: AssetSetContents;
    /** Faults in the declaration itself. A set with any of these has nothing to measure. */
    problems: AssetSetProblem[];
    /** What the panel tints on: the set does not name exactly one file for something it promises. */
    incomplete: boolean;
}

/**
 * The project's asset sets, resolved against the library.
 *
 * Resolution happens here rather than in the service for the reason the service's own note gives: a
 * set holds no member ids, so what it resolves to is a function of the library, and the library is
 * what this panel already has in hand. A service that cached the answer would have to be told about
 * every import, rename and retag to keep it true.
 */
export function useAssetSets({
    context,
    isInitialized,
    assets,
}: {
    context: WorkspaceContext | null;
    isInitialized: boolean;
    assets: Record<AssetCategory, Asset[]>;
}) {
    const [sets, setSets] = useState<AssetSet[]>([]);

    const service = useMemo(
        () => (context && isInitialized ? context.services.get<AssetSetService>(Services.AssetSets) : null),
        [context, isInitialized],
    );

    useEffect(() => {
        if (!service) {
            setSets([]);
            return;
        }
        // Read once before subscribing: the document is loaded during the service's own init, which
        // has already run by the time a panel mounts, so waiting for the next event would leave the
        // list empty until the author happened to edit something.
        try {
            setSets(service.listSets());
        } catch {
            setSets([]);
        }
        return service.onSetsChanged(next => setSets(next));
    }, [service]);

    const candidates = useMemo<AssetSetCandidate[]>(
        () => ASSET_CATEGORY_ORDER.flatMap(category =>
            assets[category].map(asset => ({ id: asset.id, type: asset.type, tags: asset.tags }))),
        [assets],
    );

    const resolved = useMemo<ResolvedAssetSet[]>(() => sets.map(set => {
        const problems = validateAssetSet(set, sets);
        const contents = resolveAssetSetContents(set, candidates, sets);
        return {
            set,
            category: categoryOfAssetType(set.type as AssetType),
            contents,
            problems,
            incomplete: problems.length > 0 || contents.missing.length > 0 || contents.ambiguous.length > 0,
        };
    }), [sets, candidates]);

    /**
     * Filed under the sidebar section each one's type belongs to, so a section can draw its own.
     *
     * Every set, nested ones included: a section draws its top level from {@link topLevel} and looks
     * the rest up here as it opens them.
     */
    const byCategory = useMemo(() => {
        const record = createEmptyAssetCategoryRecord<ResolvedAssetSet>();
        for (const entry of resolved) {
            record[entry.category].push(entry);
        }
        return record;
    }, [resolved]);

    /**
     * Every file some set answers with.
     *
     * The library lists these inside their set and nowhere else. A set is a folder to whoever is
     * browsing, and a file that appeared both in its set and in the folder it was imported into read
     * as two copies of itself - which is the one thing a set must not look like, since what it holds
     * is exactly one file per variant.
     */
    const memberAssetIds = useMemo(() => {
        const ids = new Set<string>();
        for (const entry of resolved) {
            for (const cell of entry.contents.cells) {
                for (const id of cell.assetIds) {
                    ids.add(id);
                }
            }
        }
        return ids as ReadonlySet<string>;
    }, [resolved]);

    /** The sets a section lists at its root: the ones that hang under nothing. */
    const topLevelByCategory = useMemo(() => {
        const record = createEmptyAssetCategoryRecord<ResolvedAssetSet>();
        const roots = new Set(topLevelAssetSets(sets).map(set => set.id));
        for (const entry of resolved) {
            if (roots.has(entry.set.id)) {
                record[entry.category].push(entry);
            }
        }
        return record;
    }, [resolved, sets]);

    const findSet = useCallback(
        (id: string | null | undefined) => resolved.find(entry => entry.set.id === id) ?? null,
        [resolved],
    );

    return { service, sets, resolved, byCategory, topLevelByCategory, memberAssetIds, findSet };
}
