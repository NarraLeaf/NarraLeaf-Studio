import { useMemo } from "react";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { useTranslation } from "@/lib/i18n";
import { describeAssetReadFailure } from "@/lib/workspace/assets/assetReadFailure";
import { resolveAssetDisplayName } from "@/lib/workspace/assets/assetDisplayName";
import { useAssetLibraryRevision } from "@/lib/workspace/hooks/useAssetLibraryRevision";

/**
 * Why an asset's bytes did not come, as a read reports it: the `code` of its `RequestStatus`, or
 * `ASSET_UNDECODABLE` for bytes the editor itself could not decode. The read's `error` is not here
 * on purpose - see {@link describeAssetReadFailure}.
 */
export type AssetReadFailure = { code?: string };

/**
 * The line an asset editor shows in place of the asset it could not read, or null while nothing is
 * wrong. Looked up against the library as it is now, so a rename or a delete while the tab is open
 * changes what it says.
 */
export function useAssetReadNotice(assetId: string | undefined, failure: AssetReadFailure | null): string | null {
    const { t } = useTranslation();
    const workspace = useOptionalWorkspace();
    const services = workspace?.context?.services ?? null;
    const libraryRevision = useAssetLibraryRevision();

    return useMemo(() => {
        if (!assetId || !failure) {
            return null;
        }
        return describeAssetReadFailure(assetId, resolveAssetDisplayName(services, assetId), failure.code, t);
        // `libraryRevision` is read for its change, not its value.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assetId, failure, services, libraryRevision, t]);
}
