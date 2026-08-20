import { useCallback, useMemo } from "react";
import { AssetSource, type Asset } from "@/lib/workspace/services/assets/types";
import { AssetType, categoryOfAssetType, type AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { useTranslation } from "@/lib/i18n";
import { useAssetLibraryRevision } from "@/lib/workspace/hooks/useAssetLibraryRevision";
import type { AssetSelectorVirtualGroup } from "../components/AssetSelector";
import { createEmptyAssetCategoryRecord } from "./assetCategoryRecord";
import { useAssetSets, type ResolvedAssetSet } from "./useAssetSets";

/**
 * The project's asset sets, as a section of the asset picker.
 *
 * A set is a thing a reference can point at, so it belongs in the list the reference is chosen
 * from - and it is not a file, so it belongs in a section of its own rather than filed among them.
 * Both halves of that live here so that every picker that offers sets offers the same ones, drawn
 * the same way.
 *
 * `enabled` is the caller's answer to a question this hook cannot ask: whether a set id is legal in
 * the field being edited. Assembly resolves a set named by a story block's own asset id; a set id
 * written anywhere else reaches the build as an id no library row answers.
 */
export function useAssetSetPickerSource({
    context,
    isInitialized,
    assetType,
    enabled,
}: {
    context: WorkspaceContext | null;
    isInitialized: boolean;
    assetType: AssetType;
    enabled: boolean;
}): {
    /** Passed straight to `AssetSelector`, or absent when there is nothing to offer. */
    virtualGroups?: AssetSelectorVirtualGroup[];
    /** Passed alongside them: a set's picture is the picture of what its fallback resolves to. */
    resolveAssetPreviewUrl: (asset: Asset) => Promise<string | null>;
    /** The set an id names, for a field that has to draw what it is already pointing at. */
    findSet: (id: string | null | undefined) => ResolvedAssetSet | null;
} {
    const { t } = useTranslation();
    const assetsService = useMemo(
        () => (context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null),
        [context, isInitialized],
    );
    /**
     * The library, read straight off the service.
     *
     * Not through `useAssetData`: that hook reloads the whole library on every asset event, per
     * instance, and this hook is mounted once per asset FIELD - a scene of rows, a blueprint canvas
     * of pins. Reading the records the service already holds and re-reading them when the revision
     * moves is the same answer at the cost of one pass over the records.
     */
    const revision = useAssetLibraryRevision();
    const assets = useMemo(() => {
        const record = createEmptyAssetCategoryRecord<Asset>();
        if (!assetsService) {
            return record;
        }
        for (const [type, byId] of Object.entries(assetsService.getAssets())) {
            const category: AssetCategory = categoryOfAssetType(type as AssetType);
            for (const asset of Object.values((byId ?? {}) as Record<string, Asset>)) {
                record[category].push(asset);
            }
        }
        return record;
        // `revision`: the library's records are mutated in place, so nothing else here moves when a
        // file is retagged - and a tag is exactly what decides which file answers a coordinate.
    }, [assetsService, revision]);
    const { resolved, findSet } = useAssetSets({ context, isInitialized, assets });

    const choices = useMemo(
        () => (enabled ? resolved.filter(entry => entry.set.type === assetType) : []),
        [assetType, enabled, resolved],
    );

    /**
     * The sets shaped like library rows, which is what the picker lists.
     *
     * They carry no bytes and no tags of their own: everything the picker draws for one comes from
     * the set, and the preview below comes from the file it resolves to.
     */
    const rows = useMemo<Asset[]>(() => choices.map(entry => ({
        id: entry.set.id,
        type: assetType,
        name: entry.set.name,
        ext: "",
        hash: "",
        source: AssetSource.Local,
        meta: {},
        tags: [],
        description: "",
    } as unknown as Asset)), [assetType, choices]);

    const virtualGroups = useMemo<AssetSelectorVirtualGroup[] | undefined>(
        () => (rows.length > 0
            ? [{ id: "asset-sets", title: t("assets.sets.picker.section"), assets: rows }]
            : undefined),
        [rows, t],
    );

    const resolveAssetPreviewUrl = useCallback(async (asset: Asset) => {
        const entry = choices.find(candidate => candidate.set.id === asset.id);
        if (!entry || !assetsService) {
            return null;
        }
        // The fallback's file, and any resolved variant only as a last resort: the fallback is what
        // the set shows unless a variant says otherwise, so it is the picture that names it.
        const memberId = entry.contents.cells.find(cell => cell.value === entry.set.axis.fallback)?.assetId
            ?? entry.contents.cells.find(cell => cell.assetId)?.assetId;
        const member = memberId
            ? (assetsService.getAssets()[assetType] as Record<string, Asset> | undefined)?.[memberId]
            : undefined;
        if (!member) {
            return null;
        }
        // Typed as an image read: the preview is a picture or it is nothing, and a set of anything
        // else simply draws no thumbnail rather than asking the service for bytes it cannot show.
        if (assetType !== AssetType.Image) {
            return null;
        }
        const result = await assetsService.fetch(member as Asset<AssetType.Image>);
        return result.success
            ? URL.createObjectURL(new Blob([new Uint8Array(result.data.data)]))
            : null;
    }, [assetType, assetsService, choices]);

    return { ...(virtualGroups ? { virtualGroups } : {}), resolveAssetPreviewUrl, findSet };
}
