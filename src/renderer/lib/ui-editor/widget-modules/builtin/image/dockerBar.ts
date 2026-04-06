import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import type { ImageFillMode } from "@shared/types/ui-editor/imageFill";
import { createRectangleDockerBarItems } from "../rectangle/dockerBar";
import { normalizeImageFill } from "../rectangle/helpers";
import { getImageWidgetRectangleProps } from "./helpers";

const FIT_OPTIONS: { value: ImageFillMode; label: string }[] = [
    { value: "cover", label: "Cover" },
    { value: "contain", label: "Contain" },
    { value: "stretch", label: "Stretch" },
    { value: "crop", label: "Crop" },
    { value: "tile", label: "Tile" },
];

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
                const currentFill = normalizeImageFill(getImageWidgetRectangleProps(element));
                documentService.updateElementProps(element.id, {
                    ...element.props,
                    fillType: "image",
                    imageFill: {
                        ...currentFill,
                        mode: nextMode,
                        assetId: currentFill?.assetId ?? null,
                        cropPlacement: currentFill?.cropPlacement,
                    },
                });
            },
        },
        {
            kind: "separator",
            id: "docker-image-sep-fit",
        },
    ];

    return [...fitRow, ...rectItems];
}
