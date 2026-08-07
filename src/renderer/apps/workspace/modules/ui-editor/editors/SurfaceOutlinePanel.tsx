import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { UILayersPanel } from "@/lib/ui-editor/interaction";
import type { InputDialog } from "@/lib/components/dialogs";
import type { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UIEditorReadOnly } from "@/lib/ui-editor/interaction/readOnlyInteraction";

export type SurfaceOutlinePanelProps = {
    surfaceId: string;
    stateService: UIEditorStateService | null;
    documentService: UIDocumentService | null;
    uiService: UIService | null;
    localBlueprint: LocalBlueprintService | null;
    inputDialog: InputDialog | null;
    allowAddSelectionToComponentLibrary?: boolean;
    /** Passed through to the layer tree; collapsing the panel is editor state and stays live. */
    readOnly?: UIEditorReadOnly;
};

export function SurfaceOutlinePanel({
    surfaceId,
    stateService,
    documentService,
    uiService,
    localBlueprint,
    inputDialog,
    allowAddSelectionToComponentLibrary = true,
    readOnly,
}: SurfaceOutlinePanelProps) {
    const { t } = useTranslation();
    const [isCollapsed, setCollapsedState] = useState(() => stateService?.getOutlinePanelCollapsed() ?? false);

    useEffect(() => {
        if (!stateService) {
            return undefined;
        }
        setCollapsedState(stateService.getOutlinePanelCollapsed());
        return stateService.on("outlinePanelCollapsedChanged", setCollapsedState);
    }, [stateService]);

    const setCollapsed = useCallback(
        (collapsed: boolean) => {
            setCollapsedState(collapsed);
            stateService?.setOutlinePanelCollapsed(collapsed);
        },
        [stateService],
    );

    const toggleCollapsed = useCallback(() => {
        setCollapsed(!isCollapsed);
    }, [isCollapsed, setCollapsed]);

    if (!surfaceId) {
        return null;
    }

    // A column, so the header keeps its height and the tree gets whatever is left - without this the
    // tree's own `h-full` measured the whole panel and pushed its tail out of view with no way back.
    const panelClasses = `absolute inset-y-0 left-0 z-10 flex w-64 flex-col border-r border-edge-subtle bg-surface-sunken transition-transform duration-200 ease-out ${
        isCollapsed ? "-translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100 pointer-events-auto"
    }`;

    const canShowLayers = Boolean(stateService) && Boolean(documentService) && Boolean(localBlueprint);

    return (
        <>
            <div className={panelClasses}>
                <div className="shrink-0 px-3 py-2 border-b border-edge text-xs text-fg-subtle flex items-center justify-between">
                    <span>{t("uiEditor.editor.outlineTitle")}</span>
                    <button
                        type="button"
                        className="text-fg-muted hover:text-fg transition-colors"
                        onClick={toggleCollapsed}
                        title={isCollapsed ? t("uiEditor.editor.expandOutline") : t("uiEditor.editor.collapseOutline")}
                    >
                        {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    </button>
                </div>
                {!isCollapsed && (
                    // `min-h-0` is what lets a flex child shrink below its content; without it the
                    // overflow never engages. `overscroll-contain` keeps a wheel that runs off the end
                    // of the tree from reaching the canvas behind it and zooming instead.
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                        {canShowLayers ? (
                            <UILayersPanel
                                surfaceId={surfaceId}
                                stateService={stateService!}
                                documentService={documentService!}
                                uiService={uiService}
                                localBlueprint={localBlueprint!}
                                inputDialog={inputDialog}
                                allowAddSelectionToComponentLibrary={allowAddSelectionToComponentLibrary}
                                readOnly={readOnly}
                            />
                        ) : (
                            <div className="p-4 text-xs text-fg-subtle">{t("uiEditor.editor.loadingServices")}</div>
                        )}
                    </div>
                )}
            </div>
            {isCollapsed && (
                <button
                    type="button"
                    className="absolute left-3 top-3 z-20 h-10 w-10 flex items-center justify-center rounded-full border border-edge-strong bg-surface-canvas/80 text-fg-muted hover:text-fg focus:outline-none"
                    onClick={() => setCollapsed(false)}
                    title={t("uiEditor.editor.expandOutline")}
                >
                    <ChevronDown className="w-4 h-4" />
                </button>
            )}
        </>
    );
}
