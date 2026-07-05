import { Bell } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ListRenderer } from "./list/renderer";
import { createListInspector } from "./list/inspector";
import { createListDockerBarItems } from "./list/dockerBar";
import { defaultListWidgetProps, type ListWidgetProps } from "./list/types";

const NOTIFICATION_LIST_TYPE = "nl.notification.list";

function createDefaultNotificationListProps(): ListWidgetProps {
    const props: ListWidgetProps = JSON.parse(JSON.stringify(defaultListWidgetProps));
    props.itemKeyPath = "id";
    props.itemGap = 12;
    props.previewItems = [
        { id: "preview-1", message: "Notification message" },
        { id: "preview-2", message: "Another message" },
    ];
    props.scrollbar.enabled = false;
    props.scrollbar.visibility = "hidden";
    return props;
}

/**
 * Notification slot wrapper. Runtime items ({ id, message }) are injected by the notification
 * slot bridge in the game runtime; the editor shows `previewItems` placeholders.
 */
export const NotificationListWidgetModule: UIWidgetModule = {
    type: NOTIFICATION_LIST_TYPE,
    logicApi: getWidgetLogicApi(NOTIFICATION_LIST_TYPE),
    displayName: "Notification List",
    icon: Bell,

    createDefaultElement: () => ({
        type: NOTIFICATION_LIST_TYPE,
        name: "Notification List",
        layout: {
            x: 0,
            y: 0,
            width: 420,
            height: 360,
            opacity: 1,
            visible: true,
        },
        props: createDefaultNotificationListProps(),
    }),

    render: (props: WidgetRendererProps) => <ListRenderer {...props} />,

    createInspector: createListInspector,

    createDockerBarItems: createListDockerBarItems,

    createMultiSelectDockerBarItems: createListDockerBarItems,
};
