import { useCallback, type RefObject } from "react";
import { clientToSurface } from "@/lib/ui-editor/geometry";
import {
    buildLayoutPatchForNewElementFromSurfaceRect,
    buildLayoutPatchForPointInSurface,
} from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import { resolveNewElementParent } from "@/lib/ui-editor/tree/resolveAddTarget";
import { SELECTABLE_TARGET } from "@/lib/ui-editor/interaction/constants";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { createInitialImageAppearanceFromProps } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { useAssetDropTarget } from "@/apps/workspace/dnd/useAssetDropTarget";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
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

/** How far each further image of one drop is set from the one before, so none hides another. */
const DROPPED_IMAGE_CASCADE = 24;

/**
 * The element a gesture at `point` (client pixels) lands on - the topmost selectable node of this
 * canvas there - or the surface root over empty page. What the new element's parent is worked out from
 * (`resolveNewElementParent`).
 */
function aimedElementAtClientPoint(
    viewportElement: HTMLElement | null,
    document: ReturnType<NonNullable<EditorDocumentService>["getDocument"]>,
    surfaceId: string,
    point: { x: number; y: number },
): string | null {
    const ownerDocument = viewportElement?.ownerDocument;
    if (viewportElement && typeof ownerDocument?.elementsFromPoint === "function") {
        for (const hit of ownerDocument.elementsFromPoint(point.x, point.y)) {
            const node = hit.closest(SELECTABLE_TARGET) as HTMLElement | null;
            const id = node?.dataset.uiElementId;
            if (node && id && viewportElement.contains(node) && document.elements[id]) {
                return id;
            }
        }
    }
    return resolveSurfaceRootElementId(document, surfaceId);
}

export function useSurfaceImageDrop(params: {
    viewportRef: RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    documentService: EditorDocumentService;
    surface: UISurface | null | undefined;
    stateService: EditorStateService;
    workspaceContext: WorkspaceContext | null;
}) {
    const { viewportRef, viewport, documentService, surface, stateService, workspaceContext } = params;
    const freeze = useFreezeGuard();

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
            const parentId = resolveNewElementParent(
                doc,
                surface.id,
                primaryElementId,
                aimedElementAtClientPoint(viewportRef.current, doc, surface.id, point),
            );
            if (!parentId) {
                return;
            }
            const layoutPatch = buildLayoutPatchForPointInSurface(doc, parentId, surfacePoint);
            const element = documentService.createElement(parentId, type, layoutPatch);
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
                const parentId = resolveNewElementParent(
                    doc,
                    surface.id,
                    primaryElementId,
                    aimedElementAtClientPoint(viewportRef.current, doc, surface.id, clientPosition),
                );
                if (!parentId) {
                    return;
                }

                const createdIds: string[] = [];
                // One drop, one undo step: an image used to take two (the element, then its picture),
                // and the first Cmd+Z left an empty box behind.
                documentService.runSurfaceHistoryTransaction(surface.id, () => {
                    for (let i = 0; i < resolved.length; i++) {
                        const asset = resolved[i];
                        const { width: imgW, height: imgH } = dimList[i];
                        const freshDoc = documentService.getDocument();
                        // Anchor drop at pointer: widget center aligns with surfacePoint (not top-left).
                        // Several images cascade from there instead of landing exactly on one another.
                        const cascade = i * DROPPED_IMAGE_CASCADE;
                        const layoutPatch = buildLayoutPatchForNewElementFromSurfaceRect(freshDoc, parentId, {
                            x: surfacePoint.x - imgW / 2 + cascade,
                            y: surfacePoint.y - imgH / 2 + cascade,
                            width: imgW,
                            height: imgH,
                        });
                        const element = documentService.createElement(parentId, "nl.image", layoutPatch);
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
                });

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
            // Refused at `canDrop` rather than inside `onDrop`, so the canvas never lights up as a drop
            // target: an overlay that says "drop here" and then discards the image is the half-gesture
            // that reads as a broken editor.
            canDrop: ({ resolved }) => !freeze.frozen && resolved.length > 0 && resolved.every(a => a.type === AssetType.Image),
            onDrop: handleImageAssetsDropped,
        });

    return {
        createElementAtClientPoint,
        surfaceImageDropTargetProps,
        surfaceImageDropOverlayClass,
    };
}
