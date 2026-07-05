import { ListChecks } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ListRenderer } from "./list/renderer";
import { createListInspector } from "./list/inspector";
import { createListDockerBarItems } from "./list/dockerBar";
import { defaultListWidgetProps, type ListWidgetProps } from "./list/types";

const CHOICE_LIST_TYPE = "nl.choice.list";

function createDefaultChoiceListProps(): ListWidgetProps {
    const props: ListWidgetProps = JSON.parse(JSON.stringify(defaultListWidgetProps));
    props.itemKeyPath = "index";
    props.itemGap = 16;
    props.previewItems = [
        { text: "Choice A", index: 0, disabled: false },
        { text: "Choice B", index: 1, disabled: false },
        { text: "Choice C", index: 2, disabled: true },
    ];
    props.scrollbar.enabled = false;
    props.scrollbar.visibility = "hidden";
    return props;
}

/**
 * Choice (NarraLeaf menu) slot wrapper. Runtime items ({ text, index, disabled }) are injected by
 * the choice slot bridge; hidden choices are filtered before injection. Item clicks feed the
 * `Select Choice` blueprint node through the seeded Choice widget blueprint.
 */
export const ChoiceListWidgetModule: UIWidgetModule = {
    type: CHOICE_LIST_TYPE,
    logicApi: getWidgetLogicApi(CHOICE_LIST_TYPE),
    displayName: "Choice List",
    icon: ListChecks,

    createDefaultElement: () => ({
        type: CHOICE_LIST_TYPE,
        name: "Choice List",
        layout: {
            x: 0,
            y: 0,
            width: 640,
            height: 360,
            opacity: 1,
            visible: true,
        },
        props: createDefaultChoiceListProps(),
    }),

    render: (props: WidgetRendererProps) => <ListRenderer {...props} />,

    createInspector: createListInspector,

    createDockerBarItems: createListDockerBarItems,

    createMultiSelectDockerBarItems: createListDockerBarItems,
};
