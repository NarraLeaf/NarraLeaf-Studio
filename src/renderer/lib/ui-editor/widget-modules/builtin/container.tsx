import { Box } from "lucide-react";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ContainerRenderer } from "./container/renderer";
import { createContainerInspector } from "./container/inspector";
import { defaultContainerWidgetProps } from "./container/types";

export const ContainerWidgetModule: UIWidgetModule = {
    type: "nl.container",
    supportsBlueprintLogic: true,
    displayName: "Container / Frame",
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
        props: { ...defaultContainerWidgetProps },
    }),

    render: (props: WidgetRendererProps) => <ContainerRenderer {...props} />,

    createInspector: createContainerInspector,
};
