import { Bell } from "lucide-react";
import { translate } from "@/lib/i18n";
import { UI_STRUCT_ID_NOTIFICATION_ITEM } from "@shared/types/ui-editor/builtinStructs";
import { patchListWidgetDefaultElement } from "@/lib/ui-editor/widget-modules/shared/list/listWidgetDefaults";
import type { UIWidgetDeclaration } from "../types";
import { extendWidgetDeclaration } from "../declaration";
import { ListWidgetDeclaration } from "./list.declaration";

const NOTIFICATION_LIST_TYPE = "nl.notification.list";
export const NotificationListWidgetDeclaration: UIWidgetDeclaration = extendWidgetDeclaration(ListWidgetDeclaration, {
    type: NOTIFICATION_LIST_TYPE,
    displayName: () => translate("widgets.defaults.notificationList.name"),
    icon: Bell,
    defaultElement: (inherited, words) => patchListWidgetDefaultElement(inherited, {
        layout: { width: 420, height: 360 },
        props: {
            itemStructId: UI_STRUCT_ID_NOTIFICATION_ITEM,
            itemKeyFieldId: "id",
            itemGap: 12,
            items: [
                { id: "preview-1", message: words.t("widgets.defaults.notificationList.message1") },
                { id: "preview-2", message: words.t("widgets.defaults.notificationList.message2") },
            ],
            scrollbar: { enabled: false, visibility: "hidden" },
        },
    })
});
