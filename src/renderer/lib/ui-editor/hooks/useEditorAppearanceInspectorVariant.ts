import { useEffect, useState } from "react";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";

/**
 * Subscribe to the inspector-driven appearance variant id for an element (editor canvas preview only).
 */
export function useEditorAppearanceInspectorVariant(elementId: string, enabled: boolean): string | null {
    const stateService = UIEditorStateService.getInstance();
    const [variantId, setVariantId] = useState<string | null>(() =>
        enabled ? stateService.getAppearanceInspectorVariant(elementId) : null
    );

    useEffect(() => {
        if (!enabled) {
            setVariantId(null);
            return undefined;
        }
        setVariantId(stateService.getAppearanceInspectorVariant(elementId));
        const unsub = stateService.on("appearanceInspectorVariantChanged", payload => {
            if (payload.elementId === elementId) {
                setVariantId(stateService.getAppearanceInspectorVariant(elementId));
            }
        });
        return unsub;
    }, [enabled, elementId, stateService]);

    return enabled ? variantId : null;
}
