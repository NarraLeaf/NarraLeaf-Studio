import { GAME_RUNTIME_BRIDGE_KEY, type GameRuntimePreloadBridge } from "@shared/types/gameRuntime";

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
    return getGameRuntimeBridge()?.assetUrl(assetId) ?? null;
}
