import { AssetSetService } from "../services/assets/AssetSetService";
import { AssetsService } from "../services/core/AssetsService";
import { Services, type WorkspaceContext } from "../services/services";

/**
 * What an id is called on screen, whether it names a file or an asset set.
 *
 * A story row stores an id and reads as a name, and since a row may name a set, "the library has no
 * such row" stopped meaning "this reference is broken". Every surface that prints one of these has
 * to ask both questions in the same order, or the same reference reads as a name in one place and as
 * a missing picture in another.
 *
 * Answers null for an id neither answers, which is what the callers turn into their own "this is
 * gone" phrase - the phrase differs per surface, the reading does not.
 */
export function resolveAssetDisplayName(
    services: WorkspaceContext["services"] | null | undefined,
    assetId: string,
): string | null {
    if (!services || !assetId) {
        return null;
    }
    try {
        const table = services.get<AssetsService>(Services.Assets).getAssets();
        for (const byId of Object.values(table)) {
            const asset = (byId as Record<string, { name?: string }> | undefined)?.[assetId];
            if (asset?.name) {
                return asset.name;
            }
        }
    } catch {
        // No library in this workspace: a set may still answer below.
    }
    try {
        return services.get<AssetSetService>(Services.AssetSets).getSet(assetId)?.name ?? null;
    } catch {
        return null;
    }
}
