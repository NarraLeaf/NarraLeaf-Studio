import { normalizeAudioClipRegion, type AudioClipRegion } from "@shared/types/audio";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";

/**
 * The in/out points marked on the project's audio assets, keyed by asset id.
 *
 * The editor's own equivalent of the bundle's `audio.clips`: Dev Mode and the packaged game read the
 * table the bundle assembler baked, while anything compiling in-process (the scene preview) reads the
 * live asset records here. Both reduce through the same normalizer, so a region cannot mean one thing
 * in the preview and another in the game.
 */
export function collectAudioClipRegions(assets: AssetsService | null | undefined): Record<string, AudioClipRegion> {
    const clips: Record<string, AudioClipRegion> = {};
    const audio = assets?.getAssets()[AssetType.Audio];
    for (const [assetId, asset] of Object.entries(audio ?? {})) {
        const region = normalizeAudioClipRegion(asset?.extras);
        if (region) {
            clips[assetId] = region;
        }
    }
    return clips;
}
