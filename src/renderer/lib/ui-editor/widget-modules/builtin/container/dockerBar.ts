import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import type { ContainerLayoutKind, ContainerScrollAxis, ContainerStackDirection } from "@shared/types/ui-editor/container";
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

    const chrome: DockerBarItem[] = [
        {
            kind: "number",
            id: "docker-container-radius",
            label: "Radius",
            tooltip: "Corner radius",
            value: props.borderRadius,
            min: 0,
            max: 999,
            step: 1,
            onChange: (value: number) => {
                const v = Math.max(0, value);
                const next: Record<string, unknown> = { ...element.props, borderRadius: v };
                if (props.borderRadiusLinked) {
                    next.borderRadiusTL = v;
                    next.borderRadiusTR = v;
                    next.borderRadiusBL = v;
                    next.borderRadiusBR = v;
                }
                documentService.updateElementProps(element.id, next);
            },
        },
        {
            kind: "separator",
            id: "docker-container-sep-chrome",
        },
        {
            kind: "number",
            id: "docker-container-border",
            label: "Border",
            tooltip: "Border width",
            value: props.borderWidth,
            min: 0,
            max: 64,
            step: 1,
            onChange: (value: number) => {
                patch({ borderWidth: Math.max(0, value) });
            },
        },
    ];

    const layoutMode: DockerBarItem[] = [
        {
            kind: "separator",
            id: "docker-container-sep-layout",
        },
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
                      min: 0,
                      max: 256,
                      step: 1,
                      onChange: (value: number) => {
                          patch({ stackGap: Math.max(0, value) });
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

    return [...chrome, ...layoutMode, ...stackControls, ...scrollControls];
}
