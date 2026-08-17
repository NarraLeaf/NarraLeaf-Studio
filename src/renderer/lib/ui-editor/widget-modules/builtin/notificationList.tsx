import { Bell } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { extendWidgetModule } from "@/lib/ui-editor/widget-modules/inheritance";
import { patchListWidgetDefaultElement } from "@/lib/ui-editor/widget-modules/shared/list/listWidgetDefaults";
import { ListWidgetModule } from "./list";

const NOTIFICATION_LIST_TYPE = "nl.notification.list";

/**
 * Notification slot wrapper. Runtime items ({ id, message }) are injected by the notification
 * slot bridge in the game runtime; the editor shows `previewItems` placeholders.
 */
export const NotificationListWidgetModule: UIWidgetModule = extendWidgetModule(ListWidgetModule, {
    type: NOTIFICATION_LIST_TYPE,
    displayName: () => translate("widgets.defaults.notificationList.name"),
    icon: Bell,
    defaultElement: inherited =>
        patchListWidgetDefaultElement(inherited, {
            layout: { width: 420, height: 360 },
            props: {
                itemKeyPath: "id",
                itemGap: 12,
                previewItems: [
                    { id: "preview-1", message: translate("widgets.defaults.notificationList.message1") },
                    { id: "preview-2", message: translate("widgets.defaults.notificationList.message2") },
                ],
                scrollbar: { enabled: false, visibility: "hidden" },
            },
        }),
});
