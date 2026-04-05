import { LayoutGrid } from "lucide-react";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { StackRenderer } from "./stack/renderer";
import { createStackInspector } from "./stack/inspector";
import { createStackDockerBarItems } from "./stack/dockerBar";
import { defaultStackWidgetProps } from "./stack/types";

export const StackWidgetModule: UIWidgetModule = {
    type: "nl.stack",
    supportsBlueprintLogic: false,
    displayName: "Stack",
    icon: LayoutGrid,

    createDefaultElement: () => ({
        type: "nl.stack",
        name: "Stack",
        layout: {
            x: 0,
            y: 0,
            width: 360,
            height: 280,
            opacity: 1,
            visible: true,
        },
        props: { ...defaultStackWidgetProps },
    }),

    render: (props: WidgetRendererProps) => <StackRenderer {...props} />,

    createInspector: createStackInspector,

    createDockerBarItems: createStackDockerBarItems,

    createMultiSelectDockerBarItems: createStackDockerBarItems,
};
