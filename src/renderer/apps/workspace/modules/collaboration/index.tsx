import { Radio } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { CollaborationPanel } from "./CollaborationPanel";

export const COLLABORATION_PANEL_ID = "narraleaf-studio:collaboration";

/**
 * Right-dock collaboration panel: the live session, kept on screen beside the scene being written.
 *
 * Closed by default. A session is entered from the title bar and read here, and a panel that opened
 * itself would take editor width from every author who never joins one.
 */
export const collaborationPanelModule: PanelModule = {
    metadata: {
        id: COLLABORATION_PANEL_ID,
        // Resolved lazily on read (module registration runs after i18n init).
        titleKey: "placeholders.moduleTitles.collaboration",
        get title() {
            return translate("placeholders.moduleTitles.collaboration");
        },
        icon: <Radio className="w-4 h-4" />,
        position: PanelPosition.Right,
        defaultVisible: false,
        order: 25,
    },
    component: CollaborationPanel,
};
