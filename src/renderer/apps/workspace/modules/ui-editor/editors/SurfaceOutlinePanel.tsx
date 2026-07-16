import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { UILayersPanel } from "@/lib/ui-editor/interaction";
import type { InputDialog } from "@/lib/components/dialogs";
import type { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIService } from "@/lib/workspace/services/core/UIService";

export type SurfaceOutlinePanelProps = {
    surfaceId: string;
    stateService: UIEditorStateService | null;
    documentService: UIDocumentService | null;
    uiService: UIService | null;
    localBlueprint: LocalBlueprintService | null;
    inputDialog: InputDialog | null;
    allowAddSelectionToComponentLibrary?: boolean;
};

export function SurfaceOutlinePanel({
    surfaceId,
    stateService,
    documentService,
    uiService,
    localBlueprint,
    inputDialog,
    allowAddSelectionToComponentLibrary = true,
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

    const panelClasses = `absolute inset-y-0 left-0 z-10 w-64 border-r border-edge-subtle bg-surface-sunken transition-transform duration-200 ease-out ${
        isCollapsed ? "-translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100 pointer-events-auto"
    }`;

    const canShowLayers = Boolean(stateService) && Boolean(documentService) && Boolean(localBlueprint);

    return (
        <>
            <div className={panelClasses}>
                <div className="px-3 py-2 border-b border-edge text-xs text-fg-subtle flex items-center justify-between">
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
                    <div className="h-full">
                        {canShowLayers ? (
                            <UILayersPanel
                                surfaceId={surfaceId}
                                stateService={stateService!}
                                documentService={documentService!}
                                uiService={uiService}
                                localBlueprint={localBlueprint!}
                                inputDialog={inputDialog}
                                allowAddSelectionToComponentLibrary={allowAddSelectionToComponentLibrary}
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
