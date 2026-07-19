import { useCallback, type DragEvent } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import {
    ASSET_DRAG_MIME,
    decodeAssetDragPayload,
    resolveAssetsFromDragPayload,
    type AssetDragWirePayloadV1,
} from "@/apps/workspace/modules/assets/dnd/assetDragContract";
import type { AssetDropContext } from "./types";
import { useWorkspaceAssetDragOptional } from "./WorkspaceAssetDragProvider";

/**
 * Resolves an asset drag's payload into live Asset objects. Shared by every asset drop target so
 * they all handle the same edge cases: the live-session fallback for hover phases (Chromium blanks
 * `getData` outside drop), and assets missing from the project map.
 */
export function useAssetDragResolver() {
    const { context } = useWorkspace();
    const workspaceDrag = useWorkspaceAssetDragOptional();

    const wireFromLiveSession = useCallback((): AssetDragWirePayloadV1 | null => {
        const s = workspaceDrag?.session;
        if (!s?.assets.length) {
            return null;
        }
        return {
            v: 1,
            p: s.primaryId,
            i: s.assets.map(a => ({ id: a.id, t: a.type })),
            ...(s.sourcePanelId ? { s: s.sourcePanelId } : {}),
        };
    }, [workspaceDrag?.session]);

    const buildAssetDropContext = useCallback(
        (dt: DataTransfer, phase: "drag" | "drop"): AssetDropContext | null => {
            if (!context) {
                return null;
            }
            const raw = dt.getData(ASSET_DRAG_MIME);
            let wire = decodeAssetDragPayload(raw);
            if (!wire && phase === "drag") {
                wire = wireFromLiveSession();
            }
            if (!wire) {
                return null;
            }
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            const map = assetsService.getAssets();
            let resolved = resolveAssetsFromDragPayload(wire, map);
            if (resolved.length === 0 && workspaceDrag?.session) {
                const idType = new Set(wire.i.map(x => `${x.t}:${x.id}`));
                resolved = workspaceDrag.session.assets.filter(a => idType.has(`${a.type}:${a.id}`));
            }
            if (resolved.length === 0) {
                return null;
            }
            return { wire, resolved };
        },
        [context, wireFromLiveSession, workspaceDrag?.session]
    );

    return { buildAssetDropContext };
}

/** Convenience for handlers that only hold the React synthetic event. */
export type AssetDropContextBuilder = (dt: DragEvent<Element>["dataTransfer"], phase: "drag" | "drop") => AssetDropContext | null;
