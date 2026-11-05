import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { extendWidgetModule } from "@/lib/ui-editor/widget-modules/inheritance";
import { ListWidgetModule } from "./list";
import { defineWidgetModule } from "../declaration";
import { NotificationListWidgetDeclaration } from "./notificationList.declaration";

export const NotificationListWidgetModule: UIWidgetModule = defineWidgetModule(NotificationListWidgetDeclaration, extendWidgetModule(ListWidgetModule, {
    type: NotificationListWidgetDeclaration.type,
    displayName: () => NotificationListWidgetDeclaration.displayName
}));
