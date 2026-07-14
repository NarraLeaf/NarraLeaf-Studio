import type { UIElement } from "@shared/types/ui-editor/document";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import { translate } from "@/lib/i18n";
import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { getRectangleLikeProps } from "./rectangleHelpers";

export type RectangleDockerBarOptions = {
    resolveProps?: (element: UIElement) => RectangleLikeProps;
};

export function createRectangleDockerBarItems(
    ctx: DockerBarContext,
    options?: RectangleDockerBarOptions,
): DockerBarItem[] {
    const { element, documentService } = ctx;
    const resolve = options?.resolveProps ?? getRectangleLikeProps;
    const props = resolve(element);

    return [
        {
            kind: "number",
            id: "docker-border-radius",
            label: translate("widgetChrome.dockerItems.radius"),
            tooltip: translate("widgetChrome.dockerItems.radiusHint"),
            value: props.borderRadius,
            min: 0,
            step: 1,
            onChange: (value: number) => {
                const patch: Record<string, unknown> = {
                    ...element.props,
                    borderRadius: value,
                };
                if (props.borderRadiusLinked) {
                    patch.borderRadiusTL = value;
                    patch.borderRadiusTR = value;
                    patch.borderRadiusBL = value;
                    patch.borderRadiusBR = value;
                }
                documentService.updateElementProps(element.id, patch);
            },
        },
        {
            kind: "separator",
            id: "docker-sep-1",
        },
        {
            kind: "number",
            id: "docker-border-width",
            label: translate("widgetChrome.dockerItems.border"),
            tooltip: translate("widgetChrome.dockerItems.borderHint"),
            value: props.borderWidth,
            min: 0,
            step: 1,
            onChange: (value: number) => {
                documentService.updateElementProps(element.id, {
                    ...element.props,
                    borderWidth: value,
                });
            },
        },
    ];
}
