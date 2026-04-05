import { Space } from "lucide-react";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { SpacerDividerRenderer } from "./spacerDivider/renderer";
import { createSpacerDividerInspector } from "./spacerDivider/inspector";
import { createSpacerDividerDockerBarItems } from "./spacerDivider/dockerBar";
import { defaultSpacerDividerWidgetProps } from "./spacerDivider/types";

export const SpacerDividerWidgetModule: UIWidgetModule = {
    type: "nl.spacerDivider",
    supportsBlueprintLogic: false,
    displayName: "Spacer / Divider",
    icon: Space,

    createDefaultElement: () => ({
        type: "nl.spacerDivider",
        name: "Spacer",
        layout: {
            x: 0,
            y: 0,
            width: 200,
            height: 16,
            opacity: 1,
            visible: true,
        },
        props: { ...defaultSpacerDividerWidgetProps },
    }),

    render: (props: WidgetRendererProps) => <SpacerDividerRenderer {...props} />,

    createInspector: createSpacerDividerInspector,

    createDockerBarItems: createSpacerDividerDockerBarItems,

    createMultiSelectDockerBarItems: createSpacerDividerDockerBarItems,
};
