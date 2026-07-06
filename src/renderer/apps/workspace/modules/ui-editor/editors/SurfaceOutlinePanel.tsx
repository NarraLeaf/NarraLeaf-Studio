import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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

    const panelClasses = `absolute inset-y-0 left-0 z-10 w-64 border-r border-white/5 bg-[#080a0e] transition-transform duration-200 ease-out ${
        isCollapsed ? "-translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100 pointer-events-auto"
    }`;

    const canShowLayers = Boolean(stateService) && Boolean(documentService) && Boolean(localBlueprint);

    return (
        <>
            <div className={panelClasses}>
                <div className="px-3 py-2 border-b border-white/10 text-xs text-gray-500 flex items-center justify-between">
                    <span>UI Outline</span>
                    <button
                        type="button"
                        className="text-gray-400 hover:text-white transition-colors"
                        onClick={toggleCollapsed}
                        title={isCollapsed ? "Expand outline panel" : "Collapse outline panel"}
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
                            <div className="p-4 text-xs text-gray-500">Loading editor services…</div>
                        )}
                    </div>
                )}
            </div>
            {isCollapsed && (
                <button
                    type="button"
                    className="absolute left-3 top-3 z-20 h-10 w-10 flex items-center justify-center rounded-full border border-white/20 bg-[#05060a]/80 text-gray-300 hover:text-white focus:outline-none"
                    onClick={() => setCollapsed(false)}
                    title="Expand outline panel"
                >
                    <ChevronDown className="w-4 h-4" />
                </button>
            )}
        </>
    );
}
