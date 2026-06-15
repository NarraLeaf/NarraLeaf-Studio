import { useMemo } from "react";
import { Services } from "@/lib/workspace/services/services";
import { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { listInsertPaletteModules } from "@/lib/ui-editor/widget-modules/insertPalette";
import { useWorkspace } from "@/apps/workspace/context";

export function useUISurfaceEditorServices() {
    const { context } = useWorkspace();

    const runtimeBridge = useMemo(() => {
        if (!context) return null;
        return context.services.get<UIRuntimeBridgeService>(Services.RuntimeBridge);
    }, [context]);

    const stateService = useMemo(() => {
        if (!context) return null;
        return context.services.get<UIEditorStateService>(Services.UIEditorState);
    }, [context]);

    const documentService = useMemo<UIDocumentService | null>(() => {
        if (!context) return null;
        return context.services.get<UIDocumentService>(Services.UIDocument);
    }, [context]);

    const uiService = useMemo<UIService | null>(() => {
        if (!context) return null;
        return context.services.get<UIService>(Services.UI);
    }, [context]);

    const widgetModules = useMemo(() => listInsertPaletteModules(), []);

    return {
        runtimeBridge,
        stateService,
        documentService,
        uiService,
        widgetModules,
    };
}
