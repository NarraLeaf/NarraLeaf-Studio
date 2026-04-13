import { useCallback, type RefObject } from "react";
import { clientToSurface } from "@/lib/ui-editor/geometry";
import {
    buildLayoutPatchForNewElementFromSurfaceRect,
    buildLayoutPatchForPointInSurface,
    resolveInsertTargetParent,
} from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import { createInitialImageAppearanceFromProps } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { useAssetDropTarget } from "@/apps/workspace/dnd/useAssetDropTarget";
import type { AssetDropContext } from "@/apps/workspace/dnd/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { UISurface } from "@shared/types/ui-editor/document";
import { getViewportContainerRect } from "@/apps/workspace/modules/ui-editor/editors/surfaceEditorViewportGeometry";
import type { ViewportTransform } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceEditorTabModel";
import type { EditorDocumentService, EditorStateService } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceEditorTabModel";

const DEFAULT_IMAGE_PLACEHOLDER_SIZE = 200;

export function useSurfaceImageDrop(params: {
    viewportRef: RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    documentService: EditorDocumentService;
    surface: UISurface | null | undefined;
    stateService: EditorStateService;
    workspaceContext: WorkspaceContext | null;
}) {
    const { viewportRef, viewport, documentService, surface, stateService, workspaceContext } = params;

    const createElementAtClientPoint = useCallback(
        (type: string, point: { x: number; y: number }) => {
            if (!documentService || !stateService || !surface) {
                return;
            }
            const containerRect = getViewportContainerRect(viewportRef.current);
            if (!containerRect) {
                return;
            }
            const surfacePoint = clientToSurface({ x: point.x, y: point.y }, viewport, containerRect);
            const doc = documentService.getDocument();
            const selection = stateService.getSelection();
            const selData = selection.type === "element" ? selection.data : null;
            const primaryElementId =
                selData?.surfaceId === surface.id
                    ? (selData.primaryId ?? selData.elementIds[selData.elementIds.length - 1] ?? null)
                    : null;
            const target = resolveInsertTargetParent(doc, surface.id, {
                hitElementId: null,
                primaryElementId,
            });
            if (!target) {
                return;
            }
            const layoutPatch = buildLayoutPatchForPointInSurface(doc, target.parentId, surfacePoint);
            const element = documentService.createElement(target.parentId, type, layoutPatch);
            stateService.setUIElementSelection({
                editor: "ui",
                surfaceId: surface.id,
                elementIds: [element.id],
                primaryId: element.id,
            });
            stateService.setTool({ kind: "select" });
        },
        [documentService, surface, stateService, viewport, viewportRef]
    );

    const handleImageAssetsDropped = useCallback(
        (dropCtx: AssetDropContext) => {
            const { clientPosition, resolved } = dropCtx;
            if (!clientPosition || !documentService || !stateService || !workspaceContext || !surface) {
                return;
            }
            void (async () => {
                const containerRect = getViewportContainerRect(viewportRef.current);
                if (!containerRect) {
                    return;
                }
                const surfacePoint = clientToSurface(
                    { x: clientPosition.x, y: clientPosition.y },
                    viewport,
                    containerRect
                );
                const assetsService = workspaceContext.services.get<AssetsService>(Services.Assets);
                const dimList = await Promise.all(
                    resolved.map(async asset => {
                        if (asset.type !== AssetType.Image) {
                            return {
                                width: DEFAULT_IMAGE_PLACEHOLDER_SIZE,
                                height: DEFAULT_IMAGE_PLACEHOLDER_SIZE,
                            };
                        }
                        const r = await assetsService.fetch(asset as Asset<AssetType.Image>);
                        if (!r.success || !r.data?.metadata) {
                            return {
                                width: DEFAULT_IMAGE_PLACEHOLDER_SIZE,
                                height: DEFAULT_IMAGE_PLACEHOLDER_SIZE,
                            };
                        }
                        const { width, height } = r.data.metadata;
                        return {
                            width: Number.isFinite(width) && width > 0 ? width : DEFAULT_IMAGE_PLACEHOLDER_SIZE,
                            height: Number.isFinite(height) && height > 0 ? height : DEFAULT_IMAGE_PLACEHOLDER_SIZE,
                        };
                    })
                );

                const doc = documentService.getDocument();
                const selection = stateService.getSelection();
                const selData = selection.type === "element" ? selection.data : null;
                const primaryElementId =
                    selData?.surfaceId === surface.id
                        ? (selData.primaryId ?? selData.elementIds[selData.elementIds.length - 1] ?? null)
                        : null;
                const target = resolveInsertTargetParent(doc, surface.id, {
                    hitElementId: null,
                    primaryElementId,
                });
                if (!target) {
                    return;
                }

                const createdIds: string[] = [];
                for (let i = 0; i < resolved.length; i++) {
                    const asset = resolved[i];
                    const { width: imgW, height: imgH } = dimList[i];
                    const freshDoc = documentService.getDocument();
                    // Anchor drop at pointer: widget center aligns with surfacePoint (not top-left).
                    const layoutPatch = buildLayoutPatchForNewElementFromSurfaceRect(freshDoc, target.parentId, {
                        x: surfacePoint.x - imgW / 2,
                        y: surfacePoint.y - imgH / 2,
                        width: imgW,
                        height: imgH,
                    });
                    const element = documentService.createElement(target.parentId, "nl.image", layoutPatch);
                    const nextProps: Record<string, unknown> = {
                        ...(element.props ?? {}),
                        fillType: "image",
                        imageFill: {
                            mode: "stretch",
                            assetId: asset.id,
                        },
                        borderWidth: 0,
                        strokeVisible: false,
                        appearance: createInitialImageAppearanceFromProps({
                            ...(element.props ?? {}),
                            fillType: "image",
                            imageFill: {
                                mode: "stretch",
                                assetId: asset.id,
                            },
                            borderWidth: 0,
                            strokeVisible: false,
                        }),
                    };
                    documentService.updateElementProps(element.id, nextProps);
                    createdIds.push(element.id);
                }

                if (createdIds.length > 0) {
                    stateService.setUIElementSelection({
                        editor: "ui",
                        surfaceId: surface.id,
                        elementIds: createdIds,
                        primaryId: createdIds[0],
                    });
                    stateService.setTool({ kind: "select" });
                }
            })();
        },
        [documentService, surface, stateService, viewport, viewportRef, workspaceContext]
    );

    const { dropTargetProps: surfaceImageDropTargetProps, overlayClassName: surfaceImageDropOverlayClass } =
        useAssetDropTarget({
            canDrop: ({ resolved }) => resolved.length > 0 && resolved.every(a => a.type === AssetType.Image),
            onDrop: handleImageAssetsDropped,
        });

    return {
        createElementAtClientPoint,
        surfaceImageDropTargetProps,
        surfaceImageDropOverlayClass,
    };
}
