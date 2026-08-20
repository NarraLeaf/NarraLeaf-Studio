import { GAME_RUNTIME_BRIDGE_KEY, type GameRuntimePreloadBridge } from "@shared/types/gameRuntime";
import { resolveMountedAssetSetMember } from "./assetSetAssets";

export function getGameRuntimeBridge(): GameRuntimePreloadBridge | null {
    if (typeof window === "undefined") {
        return null;
    }
    return window[GAME_RUNTIME_BRIDGE_KEY] ?? null;
}

export function resolveGameRuntimeAssetUrl(assetId: string | null | undefined): string | null {
    if (!assetId) {
        return null;
    }
    // A set id first: a packaged game resolves every asset through one id-keyed protocol handler,
    // which has no way to answer for something that names a family of files rather than one. What
    // the package carries is the answer per language - see `assetSetAssets`. An ordinary id gets
    // null back from that and is handed on untouched.
    const assetOrMember = resolveMountedAssetSetMember(assetId) ?? assetId;
    return getGameRuntimeBridge()?.assetUrl(assetOrMember) ?? null;
}
