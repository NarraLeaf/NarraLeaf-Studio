import { Box } from "lucide-react";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ContainerRenderer } from "./container/renderer";
import { createContainerInspector } from "./container/inspector";
import { createContainerDockerBarItems } from "./container/dockerBar";
import { defaultContainerWidgetProps } from "@shared/types/ui-editor/container";
import { createInitialContainerAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";

export const ContainerWidgetModule: UIWidgetModule = {
    type: "nl.container",
    supportsBlueprintLogic: true,
    displayName: "Container",
    icon: Box,

    createDefaultElement: () => ({
        type: "nl.container",
        name: "Container",
        layout: {
            x: 0,
            y: 0,
            width: 320,
            height: 240,
            opacity: 1,
            visible: true,
        },
        props: {
            ...defaultContainerWidgetProps,
            appearance: createInitialContainerAppearance(defaultContainerWidgetProps),
        },
    }),

    render: (props: WidgetRendererProps) => <ContainerRenderer {...props} />,

    createInspector: createContainerInspector,

    createDockerBarItems: createContainerDockerBarItems,

    createMultiSelectDockerBarItems: createContainerDockerBarItems,
};
