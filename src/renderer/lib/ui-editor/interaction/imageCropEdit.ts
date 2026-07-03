import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { normalizeImageFill } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import {
    resolveContainerRectangleLike,
    resolveImageRectangleLike,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";

const DEFAULT_APPEARANCE_RESOLVE_CONTEXT = {
    variantOverrideId: null,
    signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
};

export function beginImageCropEdit(params: {
    documentService: UIDocumentService;
    stateService: UIEditorStateService;
    surfaceId: string;
    elementId: string;
    source: string;
}): boolean {
    const { documentService, stateService, surfaceId, elementId, source } = params;
    const element = documentService.getDocument().elements[elementId];
    if (!element) {
        return false;
    }

    const isContainer = element.type === "nl.container";
    const isImageWidget = element.type === "nl.image";
    if (!isContainer && !isImageWidget) {
        return false;
    }

    const appearance = (element.props as { appearance?: AppearanceModel | null } | undefined)?.appearance;
    const props = isImageWidget
        ? resolveImageRectangleLike(element, appearance, DEFAULT_APPEARANCE_RESOLVE_CONTEXT)
        : resolveContainerRectangleLike(element, appearance, DEFAULT_APPEARANCE_RESOLVE_CONTEXT);
    if (props.fillType !== "image") {
        return false;
    }

    const fill = normalizeImageFill(props);
    const hasImageSource = Boolean(fill?.assetId) || Boolean(props.backgroundImage?.trim());
    if (!hasImageSource) {
        return false;
    }

    stateService.setUIElementSelection({
        editor: "ui",
        surfaceId,
        elementIds: [elementId],
        primaryId: elementId,
    });
    stateService.setInteractionOverride({
        kind: "imageCrop",
        surfaceId,
        elementId,
        source,
    });
    return true;
}
