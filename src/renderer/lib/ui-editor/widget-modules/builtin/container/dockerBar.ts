import { LayoutList, Minus } from "lucide-react";
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
            label: "Layout",
            tooltip: "How children are positioned",
            value: props.layoutKind,
            options: [
                { value: "free", label: "Free" },
                { value: "stack", label: "Stack" },
                { value: "scroll", label: "Scroll" },
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
                      label: "Gap",
                      tooltip: "Space between children",
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
                      label: "Axis",
                      tooltip: "Stack direction",
                      value: props.stackDirection,
                      options: [
                          { value: "vertical", label: "Vertical" },
                          { value: "horizontal", label: "Horizontal" },
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
                      label: "Scroll",
                      tooltip: "Scroll axis",
                      value: props.scrollAxis,
                      options: [
                          { value: "y", label: "Vertical" },
                          { value: "x", label: "Horizontal" },
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
