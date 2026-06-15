import type { Asset } from "@/lib/workspace/services/assets/types";
import type { AssetDragWirePayloadV1 } from "@/apps/workspace/modules/assets/dnd/assetDragContract";

export type { AssetDragWirePayloadV1 as WorkspaceAssetDragWirePayload } from "@/apps/workspace/modules/assets/dnd/assetDragContract";

/** Live session while dragging assets from the assets panel (same renderer). */
export interface WorkspaceAssetDragSession {
    /** Full asset snapshots at drag start (panel-local; drop targets still re-resolve from service). */
    assets: Asset[];
    primaryId: string;
    sourcePanelId?: string;
}

export interface AssetDropContext {
    wire: AssetDragWirePayloadV1;
    /** Assets resolved from AssetsService metadata at drop time (may be subset if deleted). */
    resolved: Asset[];
    /** Screen coordinates of the drop (clientX / clientY), when delivered by {@link useAssetDropTarget}. */
    clientPosition?: { x: number; y: number };
}

export interface UseAssetDropTargetOptions {
    canDrop?: (ctx: AssetDropContext) => boolean;
    onDrop: (ctx: AssetDropContext) => void;
}
