/**
 * The packaged game's side of the interface warm-up: a pack, read as what the shared walk asks for.
 *
 * The walk and the warmers are in `@/lib/ui-editor/runtime/surfaceAssetWarmup`, because a Dev Mode
 * window has to wait on exactly the set this build warms and could not reach them here. What stays
 * is the two things only a pack can answer - which asset ids it ships, and what its manifest says
 * each one is - and the font registry the packaged widgets read.
 */
import type { UISurface } from "@shared/types/ui-editor/document";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import {
    collectSurfaceWarmupAssetIds,
    collectWarmupAssetIds,
    warmInterfaceAssets,
    type RuntimePreloadProgress,
    type RuntimeSurfacePreloadResult,
    type SurfaceWarmupSource,
} from "@/lib/ui-editor/runtime/surfaceAssetWarmup";
import { loadRuntimeFontFace } from "./runtimeFontFaces";

export type { RuntimeSurfacePreloadResult } from "@/lib/ui-editor/runtime/surfaceAssetWarmup";

/**
 * The manifest ids this pack can be checked against, or null when it ships none.
 *
 * A protected build carries an empty `items` on purpose - see `GameRuntimePackV1.assets` - and a
 * project with no assets at all reaches the same place, which is why "empty" and "absent" answer
 * the same here: in both cases there is nothing to validate against and nothing lost by not trying.
 */
function packManifestIds(pack: GameRuntimePackV1): Set<string> | null {
    const ids = Object.keys(pack.assets.items);
    return ids.length > 0 ? new Set(ids) : null;
}

function packSource(pack: GameRuntimePackV1): SurfaceWarmupSource {
    return {
        uidoc: pack.bundle.ui.uidoc,
        fontAssetIds: (pack.bundle.fonts ?? []).map(entry => entry.assetId),
        manifestIds: packManifestIds(pack),
    };
}

export function collectRuntimeSurfaceAssetIds(pack: GameRuntimePackV1, surface: UISurface): string[] {
    return collectSurfaceWarmupAssetIds(packSource(pack), surface.id);
}

export function collectRuntimePackAssetIds(pack: GameRuntimePackV1, firstSurface: UISurface): {
    firstSurfaceAssetIds: string[];
    assetIds: string[];
} {
    return collectWarmupAssetIds(packSource(pack), firstSurface.id);
}

export function preloadRuntimePackAssets(input: {
    pack: GameRuntimePackV1;
    firstSurface: UISurface;
    assetUrl: (assetId: string) => string;
    timeoutMs?: number;
    onProgress?: RuntimePreloadProgress;
}): Promise<RuntimeSurfacePreloadResult> {
    return warmInterfaceAssets({
        source: packSource(input.pack),
        firstSurfaceId: input.firstSurface.id,
        assetUrl: input.assetUrl,
        entryFor: assetId => input.pack.assets.items[assetId],
        loadFont: loadRuntimeFontFace,
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });
}
