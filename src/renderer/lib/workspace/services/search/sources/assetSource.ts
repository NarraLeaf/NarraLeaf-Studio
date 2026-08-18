import { Services } from "../../services";
import { AssetsService } from "../../core/AssetsService";
import type { SearchIndexEntry } from "../searchIndexModel";
import type { SearchSource } from "../searchSource";

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
    .filter((asset) => asset.name)
    .map((asset) => {
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
        target: { kind: "asset" as const, assetId: asset.id, assetType: asset.type }
      };
    });
}

/**
 * Every imported asset, in one slice.
 *
 * No `dedupKey`, and that is a decision rather than an omission: two files that happen to share a
 * name and a tag list are still two files, each with its own preview and its own delete. Collapsing
 * them would remove a destination the author can reach today - the opposite of the blueprint case,
 * where the collapsed rows led to the same place by construction.
 */
export const assetSource: SearchSource = {
  id: "asset",
  groups: ["asset"],
  dependsOn: [Services.Assets],
  extract: (ctx) => {
    const assetsService = ctx.services.get<AssetsService>(Services.Assets);
    return extractAssetEntries(
      Object.values(assetsService.getAssets()).flatMap((byId) => Object.values(byId))
    );
  },
  // Asset imports, renames, tag edits ("updated"), deletions, and group moves all funnel through
  // these three events.
  watch: (ctx, signal) => {
    const events = ctx.services.get<AssetsService>(Services.Assets).getEvents();
    const rebuild = () => signal.invalidate();
    const unsubs = [
      events.on("updated", rebuild),
      events.on("deleted", rebuild),
      events.on("groupsUpdated", rebuild)
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }
};
