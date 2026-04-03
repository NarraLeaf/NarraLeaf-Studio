import { Type } from "lucide-react";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { TextRenderer } from "./text/renderer";
import { createTextInspector } from "./text/inspector";
import { defaultTextWidgetProps } from "./text/types";

export const TextWidgetModule: UIWidgetModule = {
    type: "nl.text",
    supportsBlueprintLogic: true,
    displayName: "Text",
    icon: Type,

    createDefaultElement: () => ({
        type: "nl.text",
        name: "Text",
        layout: {
            x: 0,
            y: 0,
            width: 240,
            height: 48,
            opacity: 1,
            visible: true,
        },
        props: { ...defaultTextWidgetProps },
    }),

    render: (props: WidgetRendererProps) => <TextRenderer {...props} />,

    createInspector: createTextInspector,
};
