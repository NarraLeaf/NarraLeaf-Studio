import { List as ListIcon } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ListRenderer } from "./list/renderer";
import { createListInspector } from "./list/inspector";
import { createListDockerBarItems } from "./list/dockerBar";
import { defaultListWidgetProps } from "./list/types";

export const ListWidgetModule: UIWidgetModule = {
    type: "nl.list",
    logicApi: getWidgetLogicApi("nl.list"),
    displayName: "List",
    icon: ListIcon,

    createDefaultElement: () => ({
        type: "nl.list",
        name: "List",
        layout: {
            x: 0,
            y: 0,
            width: 280,
            height: 220,
            opacity: 1,
            visible: true,
        },
        props: { ...defaultListWidgetProps },
    }),

    render: (props: WidgetRendererProps) => <ListRenderer {...props} />,

    createInspector: createListInspector,

    createDockerBarItems: createListDockerBarItems,

    createMultiSelectDockerBarItems: createListDockerBarItems,
};
