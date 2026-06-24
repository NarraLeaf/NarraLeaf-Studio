import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import type { ImageFill, ImageFillMode } from "@shared/types/ui-editor/imageFill";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import { isAppearanceModel } from "@shared/types/ui-editor/appearance";
import { createRectangleDockerBarItems } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleDockerBar";
import { normalizeImageFill } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { buildImageFillPropsUpdate } from "@/lib/ui-editor/widget-modules/shared/chrome/imageFillProps";
import { resolveImageRectangleLike } from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import { getImageWidgetRectangleProps } from "./helpers";

const FIT_OPTIONS: { value: ImageFillMode; label: string }[] = [
    { value: "cover", label: "Cover" },
    { value: "contain", label: "Contain" },
    { value: "stretch", label: "Stretch" },
    { value: "crop", label: "Crop" },
    { value: "tile", label: "Tile" },
];

const DEFAULT_APPEARANCE_RESOLVE_CONTEXT = {
    variantOverrideId: null,
    signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
};

export function createImageDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
    const { element, documentService } = ctx;
    const rectItems = createRectangleDockerBarItems(ctx, { resolveProps: getImageWidgetRectangleProps });
    const props = getImageWidgetRectangleProps(element);
    const fill = normalizeImageFill(props);
    const mode = fill?.mode ?? "cover";

    const fitRow: DockerBarItem[] = [
        {
            kind: "select",
            id: "docker-image-fill-mode",
            label: "Fit",
            tooltip: "Image fill mode",
            value: mode,
            options: FIT_OPTIONS,
            onChange: (value: string | number) => {
                const nextMode = String(value) as ImageFillMode;
                const liveElement = documentService.getDocument().elements[element.id] ?? element;
                const rawAppearance = (liveElement.props as { appearance?: unknown } | undefined)?.appearance;
                const appearance: AppearanceModel | undefined =
                    isAppearanceModel(rawAppearance) ? rawAppearance : undefined;
                const currentProps = resolveImageRectangleLike(
                    liveElement,
                    appearance,
                    DEFAULT_APPEARANCE_RESOLVE_CONTEXT
                );
                const currentFill = normalizeImageFill(currentProps);
                const nextImageFill: ImageFill = {
                    ...currentFill,
                    mode: nextMode,
                    assetId: currentFill?.assetId ?? null,
                    cropPlacement: currentFill?.cropPlacement,
                };

                documentService.updateElementProps(liveElement.id, buildImageFillPropsUpdate(liveElement, nextImageFill));
            },
        },
        {
            kind: "separator",
            id: "docker-image-sep-fit",
        },
    ];

    return [...fitRow, ...rectItems];
}
