import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { UITool } from "@/lib/ui-editor/editor/types";
import type { UISurface } from "@shared/types/ui-editor/document";
import { useUISurfaceEditorServices } from "@/apps/workspace/modules/ui-editor/editors/useUISurfaceEditorServices";

export type ViewportTransform = {
    scale: number;
    offsetX: number;
    offsetY: number;
};

export const DEFAULT_VIEWPORT: ViewportTransform = { scale: 1, offsetX: 0, offsetY: 0 };

type UISurfaceEditorServicesBundle = ReturnType<typeof useUISurfaceEditorServices>;
export type EditorStateService = UISurfaceEditorServicesBundle["stateService"];
export type EditorDocumentService = UISurfaceEditorServicesBundle["documentService"];
export type EditorUIService = UISurfaceEditorServicesBundle["uiService"];

export function useEditorToolState(stateService: EditorStateService) {
    const [tool, setToolState] = useState<UITool>(() => stateService?.getTool() ?? { kind: "select" });

    useEffect(() => {
        if (!stateService) return;
        setToolState(stateService.getTool());
        const unsubscribe = stateService.on("toolChanged", setToolState);
        return () => unsubscribe();
    }, [stateService]);

    return tool;
}

export function useViewportTransform(stateService: EditorStateService) {
    const [viewport, setViewport] = useState<ViewportTransform>(DEFAULT_VIEWPORT);

    useEffect(() => {
        if (!stateService) return;
        setViewport(stateService.getViewportTransform());
        const unsub = stateService.on("viewportChanged", setViewport);
        return unsub;
    }, [stateService]);

    return viewport;
}

export function useSmartSnapEnabled(stateService: EditorStateService | null | undefined) {
    const [enabled, setEnabled] = useState(() => stateService?.getSmartSnapEnabled() ?? true);

    useEffect(() => {
        if (!stateService) {
            return;
        }
        setEnabled(stateService.getSmartSnapEnabled());
        return stateService.on("smartSnapEnabledChanged", setEnabled);
    }, [stateService]);

    return enabled;
}

export function useSurfaceDocument(
    surfaceId: string | undefined,
    stateService: EditorStateService,
    documentService: EditorDocumentService
) {
    const subscribe = useCallback(
        (onStoreChange: () => void) => {
            if (!documentService) {
                return () => {};
            }
            return documentService.onDocumentChanged(() => onStoreChange());
        },
        [documentService]
    );
    const getSnapshot = useCallback(() => documentService?.getRevision() ?? 0, [documentService]);
    const documentVersion = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const document = documentService?.getDocument() ?? stateService?.getDocument();
    const surface = surfaceId && document ? document.surfaces.find((s: UISurface) => s.id === surfaceId) : undefined;

    return { surface, documentVersion };
}

export function useDocumentDirtyIndicator(
    documentService: EditorDocumentService,
    uiService: EditorUIService,
    tabId?: string
) {
    useEffect(() => {
        if (!documentService || !uiService || !tabId) {
            return undefined;
        }
        uiService.editor.setModified(tabId, documentService.isDirty());
        const unsubscribe = documentService.onDirtyChanged((dirty: boolean) => {
            uiService.editor.setModified(tabId, dirty);
        });
        return () => unsubscribe();
    }, [documentService, uiService, tabId]);
}
