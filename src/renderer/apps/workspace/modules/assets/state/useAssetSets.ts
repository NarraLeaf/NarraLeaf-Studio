import { useCallback, useEffect, useMemo, useState } from "react";
import {
    deriveAssetSetDraft,
    parseAssetTag,
    resolveAssetSetContents,
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
        const problems = validateAssetSet(set);
        const contents = resolveAssetSetContents(set, candidates);
        return {
            set,
            category: categoryOfAssetType(set.type as AssetType),
            contents,
            problems,
            incomplete: problems.length > 0 || contents.missing.length > 0 || contents.ambiguous.length > 0,
        };
    }), [sets, candidates]);

    /** Filed under the sidebar section each one's type belongs to, so a section can draw its own. */
    const byCategory = useMemo(() => {
        const record = createEmptyAssetCategoryRecord<ResolvedAssetSet>();
        for (const entry of resolved) {
            record[entry.category].push(entry);
        }
        return record;
    }, [resolved]);

    const findSet = useCallback(
        (id: string | null | undefined) => resolved.find(entry => entry.set.id === id) ?? null,
        [resolved],
    );

    /**
     * Make a set out of the rows the author has marked.
     *
     * The tags on those rows are the declaration - see `deriveAssetSetDraft`. Refused for a
     * selection spanning two asset types: a set resolves within one type, and picking one of them
     * would silently leave the other half out of everything the set is about.
     */
    /**
     * The name to offer for a set made of these rows.
     *
     * The values of the tags they all agree on - `char:alice` and `outfit:school` suggest
     * "alice school" - because those are what the set *is*, whereas the first file's name is one
     * corner of it (`alice-happy-en` for a set that also holds sad and Japanese). Empty when the
     * rows agree on nothing, which is the honest answer: there is no name to guess.
     */
    const suggestNameFor = useCallback((selected: readonly Asset[]): string => {
        if (selected.length === 0) {
            return "";
        }
        const draft = deriveAssetSetDraft(selected.map(asset => ({
            id: asset.id,
            type: asset.type,
            tags: asset.tags,
        })));
        return draft.filter
            .map(tag => parseAssetTag(tag)?.value)
            .filter((value): value is string => Boolean(value))
            .join(" ");
    }, []);

    const createFromAssets = useCallback((selected: readonly Asset[], name: string): AssetSet | null => {
        if (!service || selected.length === 0) {
            return null;
        }
        const type = selected[0].type;
        if (selected.some(asset => asset.type !== type)) {
            return null;
        }
        const draft = deriveAssetSetDraft(selected.map(asset => ({
            id: asset.id,
            type: asset.type,
            tags: asset.tags,
        })));
        return service.createSet({ name, type, filter: draft.filter, axes: draft.axes });
    }, [service]);

    return { service, sets, resolved, byCategory, findSet, createFromAssets, suggestNameFor };
}
