import { useCallback, useRef, useState, type DragEvent } from "react";
import { isWorkspaceAssetDragEvent } from "@/apps/workspace/modules/assets/dnd/assetDragContract";
import type { UseAssetDropTargetOptions } from "./types";
import { workspaceAssetDropTargetClass } from "./useAssetDropFeedback";
import { useAssetDragResolver } from "./useAssetDragResolver";

/**
 * HTML5 drop target for workspace asset drags. Parses payload at drop time via AssetsService.
 */
export function useAssetDropTarget(options: UseAssetDropTargetOptions) {
    const { canDrop, onDrop } = options;
    const { buildAssetDropContext: buildContext } = useAssetDragResolver();
    const enterCounter = useRef(0);
    const [isHovering, setIsHovering] = useState(false);
    const [isAccepted, setIsAccepted] = useState(false);

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
