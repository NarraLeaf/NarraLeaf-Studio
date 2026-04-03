import { ScrollText } from "lucide-react";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ScrollRenderer } from "./scroll/renderer";
import { createScrollInspector } from "./scroll/inspector";
import { defaultScrollWidgetProps } from "./scroll/types";

export const ScrollWidgetModule: UIWidgetModule = {
    type: "nl.scroll",
    supportsBlueprintLogic: false,
    displayName: "Scroll",
    icon: ScrollText,

    createDefaultElement: () => ({
        type: "nl.scroll",
        name: "Scroll",
        layout: {
            x: 0,
            y: 0,
            width: 320,
            height: 240,
            opacity: 1,
            visible: true,
        },
        props: { ...defaultScrollWidgetProps },
    }),

    render: (props: WidgetRendererProps) => <ScrollRenderer {...props} />,

    createInspector: createScrollInspector,
};
