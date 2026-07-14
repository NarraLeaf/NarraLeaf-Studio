import { LayoutList, Minus } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import {
    clampContainerStackSpacingPx,
    CONTAINER_STACK_SPACING_ABS_MAX_PX,
    type ContainerLayoutKind,
    type ContainerScrollAxis,
    type ContainerStackDirection,
} from "@shared/types/ui-editor/container";
import { buildDividerPreset, buildVerticalStackPreset } from "./dockerPresets";
import { getContainerProps } from "./helpers";

export function createContainerDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
    const { element, documentService } = ctx;
    const props = getContainerProps(element);
    const patch = (partial: Record<string, unknown>) => {
        documentService.updateElementProps(element.id, {
            ...element.props,
            ...partial,
        });
    };

    const layoutMode: DockerBarItem[] = [
        {
            kind: "select",
            id: "docker-container-layout-kind",
            label: translate("widgetChrome.dockerItems.layout"),
            tooltip: translate("widgetChrome.dockerItems.layoutHint"),
            value: props.layoutKind,
            options: [
                { value: "free", label: translate("widgetChrome.dockerItems.free") },
                { value: "stack", label: translate("widgetChrome.dockerItems.stack") },
                { value: "scroll", label: translate("widgetChrome.dockerItems.scroll") },
            ],
            onChange: (value: string | number) => {
                patch({ layoutKind: String(value) as ContainerLayoutKind });
            },
        },
    ];

    const stackControls: DockerBarItem[] =
        props.layoutKind === "stack" || props.layoutKind === "scroll"
            ? [
                  {
                      kind: "number",
                      id: "docker-container-stack-gap",
                      label: translate("widgetChrome.dockerItems.gap"),
                      tooltip: translate("widgetChrome.dockerItems.gapChildrenHint"),
                      value: props.stackGap,
                      min: -CONTAINER_STACK_SPACING_ABS_MAX_PX,
                      max: CONTAINER_STACK_SPACING_ABS_MAX_PX,
                      step: 1,
                      onChange: (value: number) => {
                          patch({ stackGap: clampContainerStackSpacingPx(value) });
                      },
                  },
                  {
                      kind: "select",
                      id: "docker-container-stack-direction",
                      label: translate("widgetChrome.dockerItems.axis"),
                      tooltip: translate("widgetChrome.dockerItems.axisHint"),
                      value: props.stackDirection,
                      options: [
                          { value: "vertical", label: translate("widgetChrome.dockerItems.vertical") },
                          { value: "horizontal", label: translate("widgetChrome.dockerItems.horizontal") },
                      ],
                      onChange: (value: string | number) => {
                          patch({ stackDirection: String(value) as ContainerStackDirection });
                      },
                  },
              ]
            : [];

    const scrollControls: DockerBarItem[] =
        props.layoutKind === "scroll"
            ? [
                  {
                      kind: "select",
                      id: "docker-container-scroll-axis",
                      label: translate("widgetChrome.dockerItems.scrollAxis"),
                      tooltip: translate("widgetChrome.dockerItems.scrollAxisHint"),
                      value: props.scrollAxis,
                      options: [
                          { value: "y", label: translate("widgetChrome.dockerItems.vertical") },
                          { value: "x", label: translate("widgetChrome.dockerItems.horizontal") },
                      ],
                      onChange: (value: string | number) => {
                          patch({ scrollAxis: String(value) as ContainerScrollAxis });
                      },
                  },
              ]
            : [];

    // const presets: DockerBarItem[] = [
    //     {
    //         kind: "separator",
    //         id: "docker-container-sep-presets",
    //     },
    //     {
    //         kind: "button",
    //         id: "docker-container-preset-divider",
    //         icon: Minus,
    //         label: "Divider",
    //         tooltip: "Divider preset: thin strip (adjust width on canvas)",
    //         onClick: () => {
    //             const { layout, props: presetProps } = buildDividerPreset();
    //             documentService.updateElementLayout(element.id, { ...element.layout, ...layout });
    //             documentService.updateElementProps(element.id, {
    //                 ...element.props,
    //                 ...presetProps,
    //             });
    //         },
    //     },
    //     {
    //         kind: "button",
    //         id: "docker-container-preset-stack-v",
    //         icon: LayoutList,
    //         label: "V stack",
    //         tooltip: "Vertical stack layout (flow children)",
    //         onClick: () => {
    //             const { props: presetProps } = buildVerticalStackPreset();
    //             documentService.updateElementProps(element.id, {
    //                 ...element.props,
    //                 ...presetProps,
    //             });
    //         },
    //     },
    // ];

    return [...layoutMode, ...stackControls, ...scrollControls, /* ...presets */];
}
