import { Bell } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { NotificationsPanel } from "./NotificationsPanel";

export const NOTIFICATIONS_PANEL_ID = "narraleaf-studio:notifications";

/** Right-dock notification center: the persisted toast history with one-click clear. */
export const notificationsPanelModule: PanelModule = {
    metadata: {
        id: NOTIFICATIONS_PANEL_ID,
        // Resolved lazily on read (module registration runs after i18n init).
        titleKey: "placeholders.moduleTitles.notifications",
        get title() {
            return translate("placeholders.moduleTitles.notifications");
        },
        icon: <Bell className="w-4 h-4" />,
        position: PanelPosition.Right,
        defaultVisible: false,
        order: 30,
    },
    component: NotificationsPanel,
};
