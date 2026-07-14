import { translate } from "@/lib/i18n";
import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { getListProps } from "./helpers";

export function createListDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
    const { element, documentService } = ctx;
    const props = getListProps(element);

    return [
        {
            kind: "number",
            id: "docker-list-item-gap",
            label: translate("widgetChrome.dockerItems.gap"),
            tooltip: translate("widgetChrome.dockerItems.listGapHint"),
            value: props.itemGap,
            min: 0,
            max: 128,
            step: 1,
            onChange: (value: number) => {
                documentService.updateElementProps(element.id, {
                    ...element.props,
                    itemGap: Math.max(0, value),
                });
            },
        },
        {
            kind: "separator",
            id: "docker-list-sep",
        },
        {
            kind: "number",
            id: "docker-list-preview",
            label: translate("widgetChrome.dockerItems.preview"),
            tooltip: translate("widgetChrome.dockerItems.previewHint"),
            value: props.previewCount,
            min: 1,
            max: 32,
            step: 1,
            onChange: (value: number) => {
                const clamped = Math.min(32, Math.max(1, Math.round(value)));
                documentService.updateElementProps(element.id, {
                    ...element.props,
                    previewCount: clamped,
                });
            },
        },
    ];
}
