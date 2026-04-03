import { List } from "lucide-react";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ListRepeaterRenderer } from "./listRepeater/renderer";
import { createListRepeaterInspector } from "./listRepeater/inspector";
import { defaultListRepeaterWidgetProps } from "./listRepeater/types";

export const ListRepeaterWidgetModule: UIWidgetModule = {
    type: "nl.listRepeater",
    supportsBlueprintLogic: false,
    displayName: "List / Repeater",
    icon: List,

    createDefaultElement: () => ({
        type: "nl.listRepeater",
        name: "List",
        layout: {
            x: 0,
            y: 0,
            width: 280,
            height: 220,
            opacity: 1,
            visible: true,
        },
        props: { ...defaultListRepeaterWidgetProps },
    }),

    render: (props: WidgetRendererProps) => <ListRepeaterRenderer {...props} />,

    createInspector: createListRepeaterInspector,
};
