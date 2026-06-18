import { useEffect } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { PreviewStudioBlueprintOpenPayload } from "@shared/types/previewStudioBlueprintOpen";
import { useRegistry } from "@/apps/workspace/registry";
import { createBlueprintEntryEditorTab } from "./openBlueprintEditorTab";

/**
 * Listens for Dev Mode → Workspace IPC and opens the blueprint editor tab.
 */
export function PreviewBlueprintNavigateBridge(): null {
    const { openEditorTab } = useRegistry();

    useEffect(() => {
        const token = getInterface().workspace.onBlueprintNavigateFromPreview((payload: PreviewStudioBlueprintOpenPayload) => {
            openEditorTab(
                createBlueprintEntryEditorTab({
                    blueprintId: payload.blueprintId,
                    ownerKind: payload.ownerKind,
                    surfaceId: payload.surfaceId,
                    elementId: payload.elementId,
                    propPath: payload.propPath,
                    title: payload.title,
                    focusEventId: payload.focusEventId,
                    focusFunctionId: payload.focusFunctionId,
                    focusFieldId: payload.focusFieldId,
                    focusNodeId: payload.focusNodeId,
                }),
            );
        });
        return () => token.cancel();
    }, [openEditorTab]);

    return null;
}
