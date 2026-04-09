import { useCallback, useRef, useState, type DragEvent } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import {
    ASSET_DRAG_MIME,
    decodeAssetDragPayload,
    isWorkspaceAssetDragEvent,
    resolveAssetsFromDragPayload,
    type AssetDragWirePayloadV1,
} from "@/apps/workspace/modules/assets/dnd/assetDragContract";
import type { AssetDropContext, UseAssetDropTargetOptions } from "./types";
import { workspaceAssetDropTargetClass } from "./useAssetDropFeedback";
import { useWorkspaceAssetDragOptional } from "./WorkspaceAssetDragProvider";

/**
 * HTML5 drop target for workspace asset drags. Parses payload at drop time via AssetsService.
 */
export function useAssetDropTarget(options: UseAssetDropTargetOptions) {
    const { canDrop, onDrop } = options;
    const { context } = useWorkspace();
    const workspaceDrag = useWorkspaceAssetDragOptional();
    const enterCounter = useRef(0);
    const [isHovering, setIsHovering] = useState(false);
    const [isAccepted, setIsAccepted] = useState(false);

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

    const buildContext = useCallback(
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

    const evaluateAccept = useCallback(
        (dt: DataTransfer): boolean => {
            if (!isWorkspaceAssetDragEvent(dt)) {
                return false;
            }
            const ctx = buildContext(dt, "drag");
            if (!ctx) {
                return false;
            }
            if (canDrop && !canDrop(ctx)) {
                return false;
            }
            return true;
        },
        [buildContext, canDrop]
    );

    const onDragEnter = useCallback(
        (e: DragEvent<Element>) => {
            if (!isWorkspaceAssetDragEvent(e.dataTransfer)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            enterCounter.current += 1;
            setIsHovering(true);
            const ok = evaluateAccept(e.dataTransfer);
            setIsAccepted(ok);
            e.dataTransfer.dropEffect = ok ? "copy" : "none";
        },
        [evaluateAccept]
    );

    const onDragOver = useCallback(
        (e: DragEvent<Element>) => {
            if (!isWorkspaceAssetDragEvent(e.dataTransfer)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const ok = evaluateAccept(e.dataTransfer);
            setIsAccepted(ok);
            e.dataTransfer.dropEffect = ok ? "copy" : "none";
        },
        [evaluateAccept]
    );

    const onDragLeave = useCallback((e: DragEvent<Element>) => {
        if (!isWorkspaceAssetDragEvent(e.dataTransfer)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        enterCounter.current = Math.max(0, enterCounter.current - 1);
        if (enterCounter.current === 0) {
            setIsHovering(false);
            setIsAccepted(false);
        }
    }, []);

    const handleDrop = useCallback(
        (e: DragEvent<Element>) => {
            if (!isWorkspaceAssetDragEvent(e.dataTransfer)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            enterCounter.current = 0;
            setIsHovering(false);
            setIsAccepted(false);
            const ctx = buildContext(e.dataTransfer, "drop");
            if (!ctx) {
                return;
            }
            if (canDrop && !canDrop(ctx)) {
                return;
            }
            onDrop({
                ...ctx,
                clientPosition: { x: e.clientX, y: e.clientY },
            });
        },
        [buildContext, canDrop, onDrop]
    );

    return {
        dropTargetProps: {
            onDragEnter,
            onDragOver,
            onDragLeave,
            onDrop: handleDrop,
        },
        isHovering,
        isAccepted,
        overlayClassName: workspaceAssetDropTargetClass(isHovering && isAccepted),
    };
}
