import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { UITool } from "@/lib/ui-editor/editor/types";
import type { UIStageSlotId, UISurface } from "@shared/types/ui-editor/document";
import type { SmartSnapDetailSettings } from "@/lib/ui-editor/snapping/types";
import { DEFAULT_SMART_SNAP_DETAIL_SETTINGS } from "@/lib/ui-editor/snapping/types";
import {
    DEFAULT_UI_EDITOR_GRID_SPACING,
    DEFAULT_UI_EDITOR_GRID_STYLE,
    type UIEditorGridStyle,
} from "@/lib/ui-editor/snapping/gridSnap";
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

export function useSmartSnapDetailSettings(stateService: EditorStateService | null | undefined) {
    const [detail, setDetail] = useState<SmartSnapDetailSettings>(
        () => stateService?.getSmartSnapDetailSettings() ?? DEFAULT_SMART_SNAP_DETAIL_SETTINGS,
    );

    useEffect(() => {
        if (!stateService) {
            setDetail(DEFAULT_SMART_SNAP_DETAIL_SETTINGS);
            return undefined;
        }
        setDetail(stateService.getSmartSnapDetailSettings());
        return stateService.on("smartSnapDetailSettingsChanged", setDetail);
    }, [stateService]);

    return detail;
}

/** The project's canvas grid spacing in design pixels. Editor state - never dirties the project. */
export function useGridSpacing(stateService: EditorStateService | null | undefined) {
    const [spacing, setSpacing] = useState(() => stateService?.getGridSpacing() ?? DEFAULT_UI_EDITOR_GRID_SPACING);

    useEffect(() => {
        if (!stateService) {
            setSpacing(DEFAULT_UI_EDITOR_GRID_SPACING);
            return undefined;
        }
        setSpacing(stateService.getGridSpacing());
        return stateService.on("gridSpacingChanged", setSpacing);
    }, [stateService]);

    return spacing;
}

/** Whether the canvas grid is drawn as lines or dots. A Studio-wide drawing preference. */
export function useGridStyle(stateService: EditorStateService | null | undefined) {
    const [style, setStyle] = useState<UIEditorGridStyle>(() => stateService?.getGridStyle() ?? DEFAULT_UI_EDITOR_GRID_STYLE);

    useEffect(() => {
        if (!stateService) {
            setStyle(DEFAULT_UI_EDITOR_GRID_STYLE);
            return undefined;
        }
        setStyle(stateService.getGridStyle());
        return stateService.on("gridStyleChanged", setStyle);
    }, [stateService]);

    return style;
}

/** Screen-ratio preview frame preset id (`null` = off). Pure view state — never dirties the project. */
export function usePreviewAspectId(stateService: EditorStateService | null | undefined) {
    const [aspectId, setAspectId] = useState<string | null>(
        () => stateService?.getPreviewAspectId() ?? null,
    );

    useEffect(() => {
        if (!stateService) {
            setAspectId(null);
            return undefined;
        }
        setAspectId(stateService.getPreviewAspectId());
        return stateService.on("previewAspectChanged", setAspectId);
    }, [stateService]);

    return aspectId;
}

/** Safe-area preview frame device preset id (`null` = off). Pure view state — never dirties the project. */
export function usePreviewSafeAreaId(stateService: EditorStateService | null | undefined) {
    const [safeAreaId, setSafeAreaId] = useState<string | null>(
        () => stateService?.getPreviewSafeAreaId() ?? null,
    );

    useEffect(() => {
        if (!stateService) {
            setSafeAreaId(null);
            return undefined;
        }
        setSafeAreaId(stateService.getPreviewSafeAreaId());
        return stateService.on("previewSafeAreaChanged", setSafeAreaId);
    }, [stateService]);

    return safeAreaId;
}

const NO_REFERENCE_SLOTS: readonly UIStageSlotId[] = [];

/** Game UI slots drawn as a reference on a Game UI canvas. Pure view state — never dirties the project. */
export function usePreviewReferenceSlotIds(stateService: EditorStateService | null | undefined) {
    const [slotIds, setSlotIds] = useState<readonly UIStageSlotId[]>(
        () => stateService?.getPreviewReferenceSlotIds() ?? NO_REFERENCE_SLOTS,
    );

    useEffect(() => {
        if (!stateService) {
            setSlotIds(NO_REFERENCE_SLOTS);
            return undefined;
        }
        setSlotIds(stateService.getPreviewReferenceSlotIds());
        return stateService.on("previewReferenceSlotsChanged", setSlotIds);
    }, [stateService]);

    return slotIds;
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
