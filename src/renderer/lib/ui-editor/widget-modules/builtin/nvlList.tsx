import { ScrollText } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ListRenderer } from "./list/renderer";
import { createListInspector } from "./list/inspector";
import { createListDockerBarItems } from "./list/dockerBar";
import { defaultListWidgetProps, type ListWidgetProps } from "./list/types";

const NVL_LIST_TYPE = "nl.nvl.list";

function createDefaultNvlListProps(): ListWidgetProps {
    const props: ListWidgetProps = JSON.parse(JSON.stringify(defaultListWidgetProps));
    props.itemKeyPath = "index";
    props.itemGap = 18;
    props.previewItems = [
        { nametag: translate("widgets.defaults.nvlList.speaker"), index: 0, isActive: false },
        { nametag: "", index: 1, isActive: true },
    ];
    return props;
}

/**
 * NVL slot wrapper. Runtime items ({ nametag, isActive, index }) are injected by the NVL slot
 * bridge; the raw NvlDialogProxy entries flow through `NvlSlotItemsContext` so the private
 * `nl.nvl.texts` leaf can render the engine-coupled type effect.
 */
export const NvlListWidgetModule: UIWidgetModule = {
    type: NVL_LIST_TYPE,
    logicApi: getWidgetLogicApi(NVL_LIST_TYPE),
    get displayName() {
        return translate("widgets.defaults.nvlList.name");
    },
    icon: ScrollText,

    createDefaultElement: () => ({
        type: NVL_LIST_TYPE,
        name: translate("widgets.defaults.nvlList.name"),
        layout: {
            x: 0,
            y: 0,
            width: 960,
            height: 620,
            opacity: 1,
            visible: true,
        },
        props: createDefaultNvlListProps(),
    }),

    render: (props: WidgetRendererProps) => <ListRenderer {...props} />,

    createInspector: createListInspector,

    createDockerBarItems: createListDockerBarItems,

    createMultiSelectDockerBarItems: createListDockerBarItems,
};
