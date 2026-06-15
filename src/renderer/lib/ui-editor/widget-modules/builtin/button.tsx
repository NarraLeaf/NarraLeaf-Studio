import { MousePointerClick } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ButtonRenderer } from "./button/renderer";
import { createButtonInspector } from "./button/inspector";
import { createButtonDockerBarItems } from "./button/dockerBar";
import { defaultButtonWidgetProps } from "./button/types";
import { createInitialButtonAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";

export const ButtonWidgetModule: UIWidgetModule = {
    type: "nl.button",
    logicApi: getWidgetLogicApi("nl.button"),
    displayName: "Button",
    icon: MousePointerClick,

    createDefaultElement: () => ({
        type: "nl.button",
        name: "Button",
        layout: {
            x: 0,
            y: 0,
            width: 160,
            height: 48,
            opacity: 1,
            visible: true,
        },
        props: {
            ...defaultButtonWidgetProps,
            appearance: createInitialButtonAppearance(defaultButtonWidgetProps),
            label: "Button",
        },
    }),

    render: (props: WidgetRendererProps) => <ButtonRenderer {...props} />,

    createInspector: createButtonInspector,

    createDockerBarItems: createButtonDockerBarItems,

    createMultiSelectDockerBarItems: createButtonDockerBarItems,
};
