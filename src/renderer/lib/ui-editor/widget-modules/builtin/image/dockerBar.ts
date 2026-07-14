import { translate } from "@/lib/i18n";
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

const FIT_OPTION_VALUES: readonly ImageFillMode[] = ["cover", "contain", "stretch", "crop", "tile"];

const FIT_OPTION_LABEL_KEYS = {
    cover: "widgetChrome.dockerItems.cover",
    contain: "widgetChrome.dockerItems.contain",
    stretch: "widgetChrome.dockerItems.stretch",
    crop: "widgetChrome.dockerItems.crop",
    tile: "widgetChrome.dockerItems.tile",
} as const;

const DEFAULT_APPEARANCE_RESOLVE_CONTEXT = {
    variantOverrideId: null,
    signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
};

export function createImageDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
    const { element, documentService, stateService, surfaceId } = ctx;
    const rectItems = createRectangleDockerBarItems(ctx, { resolveProps: getImageWidgetRectangleProps });
    const rawAppearance = (element.props as { appearance?: unknown } | undefined)?.appearance;
    const appearance: AppearanceModel | undefined = isAppearanceModel(rawAppearance) ? rawAppearance : undefined;
    const props = resolveImageRectangleLike(element, appearance, DEFAULT_APPEARANCE_RESOLVE_CONTEXT);
    const fill = normalizeImageFill(props);
    const mode = fill?.mode ?? "cover";

    const fitRow: DockerBarItem[] = [
        {
            kind: "select",
            id: "docker-image-fill-mode",
            label: translate("widgetChrome.dockerItems.fit"),
            tooltip: translate("widgetChrome.dockerItems.fitHint"),
            value: mode,
            options: FIT_OPTION_VALUES.map(value => ({
                value,
                label: translate(FIT_OPTION_LABEL_KEYS[value]),
            })),
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
                const override = stateService?.getInteractionOverride();
                if (
                    nextMode !== "crop" &&
                    override?.kind === "imageCrop" &&
                    override.elementId === liveElement.id &&
                    (!surfaceId || override.surfaceId === surfaceId)
                ) {
                    stateService?.setInteractionOverride(null);
                }
            },
        },
        {
            kind: "separator",
            id: "docker-image-sep-fit",
        },
    ];

    return [...fitRow, ...rectItems];
}
