import { useCallback, useEffect, type RefObject } from "react";
import type { InteractionOverrideChange } from "@/lib/workspace/services/services";
import type { EditorStateService } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceEditorTabModel";

export function useSurfaceInteractionCropDimming(params: {
    surfaceId: string | undefined;
    stateService: EditorStateService;
    canvasRef: RefObject<HTMLDivElement | null>;
    documentVersion: number;
}) {
    const { surfaceId, stateService, canvasRef, documentVersion } = params;

    const updateCropDimming = useCallback(
        (payload: InteractionOverrideChange) => {
            const canvas = canvasRef.current;
            if (!canvas) {
                return;
            }
            const override = payload.next;
            const nodes = canvas.querySelectorAll<HTMLElement>(".ui-editor-node:not(.ui-editor-node-root)");
            nodes.forEach(node => {
                if (override?.kind === "imageCrop" && override.surfaceId === surfaceId) {
                    const isActive = node.dataset.uiElementId === override.elementId;
                    if (isActive) {
                        delete node.dataset.uiCropDim;
                    } else {
                        node.dataset.uiCropDim = "true";
                    }
                } else {
                    delete node.dataset.uiCropDim;
                }
            });
        },
        [surfaceId]
    );

    useEffect(() => {
        if (!stateService) {
            return;
        }
        const current = stateService.getInteractionOverride();
        updateCropDimming({ previous: null, next: current });
        const unsubscribe = stateService.on("interactionOverrideChanged", updateCropDimming);
        return () => {
            unsubscribe();
            updateCropDimming({ previous: null, next: null });
        };
    }, [stateService, updateCropDimming, documentVersion]);
}
