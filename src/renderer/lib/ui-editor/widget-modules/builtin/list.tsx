import { List as ListIcon } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ListRenderer } from "./list/renderer";
import { createListInspector } from "./list/inspector";
import { createListDockerBarItems } from "./list/dockerBar";
import { defaultListWidgetProps } from "./list/types";

function createDefaultListProps() {
    return JSON.parse(JSON.stringify(defaultListWidgetProps));
}

export const ListWidgetModule: UIWidgetModule = {
    type: "nl.list",
    logicApi: getWidgetLogicApi("nl.list"),
    get displayName() {
        return translate("widgets.defaults.list.name");
    },
    icon: ListIcon,

    createDefaultElement: () => ({
        type: "nl.list",
        name: translate("widgets.defaults.list.name"),
        layout: {
            x: 0,
            y: 0,
            width: 280,
            height: 220,
            opacity: 1,
            visible: true,
        },
        props: createDefaultListProps(),
    }),

    render: (props: WidgetRendererProps) => <ListRenderer {...props} />,

    createInspector: createListInspector,

    createDockerBarItems: createListDockerBarItems,

    createMultiSelectDockerBarItems: createListDockerBarItems,
};
