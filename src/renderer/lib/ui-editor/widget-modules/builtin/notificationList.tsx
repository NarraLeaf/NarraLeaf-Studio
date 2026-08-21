import { Bell } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { UI_STRUCT_ID_NOTIFICATION_ITEM } from "@shared/types/ui-editor/builtinStructs";
import { extendWidgetModule } from "@/lib/ui-editor/widget-modules/inheritance";
import { patchListWidgetDefaultElement } from "@/lib/ui-editor/widget-modules/shared/list/listWidgetDefaults";
import { ListWidgetModule } from "./list";

const NOTIFICATION_LIST_TYPE = "nl.notification.list";

/**
 * Notification slot wrapper. Runtime items are injected by the notification slot bridge in the game
 * runtime; the authored rows below are what the editor draws. The shape is the engine's - see the
 * built-in struct it names.
 */
export const NotificationListWidgetModule: UIWidgetModule = extendWidgetModule(ListWidgetModule, {
    type: NOTIFICATION_LIST_TYPE,
    displayName: () => translate("widgets.defaults.notificationList.name"),
    icon: Bell,
    defaultElement: inherited =>
        patchListWidgetDefaultElement(inherited, {
            layout: { width: 420, height: 360 },
            props: {
                itemStructId: UI_STRUCT_ID_NOTIFICATION_ITEM,
                itemKeyFieldId: "id",
                itemGap: 12,
                items: [
                    { id: "preview-1", message: translate("widgets.defaults.notificationList.message1") },
                    { id: "preview-2", message: translate("widgets.defaults.notificationList.message2") },
                ],
                scrollbar: { enabled: false, visibility: "hidden" },
            },
        }),
});
