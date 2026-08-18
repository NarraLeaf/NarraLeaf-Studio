import { Settings } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelModule } from "../types";
import { PropertiesPanel } from "./PropertiesPanel";
import { PROPERTIES_PANEL_ID } from "./propertiesPanelId";
import { PanelPosition } from "../../registry/types";

/**
 * Properties panel module
 * Displays and edits properties of selected items
 */
export const propertiesModule: PanelModule = {
  metadata: {
    id: PROPERTIES_PANEL_ID,
    // Resolved lazily on read (module registration runs after i18n init).
    titleKey: "placeholders.moduleTitles.properties",
    get title() {
      return translate("placeholders.moduleTitles.properties");
    },
    icon: <Settings className="w-4 h-4" />,
    position: PanelPosition.Right,
    defaultVisible: true,
    order: 0
  },
  component: PropertiesPanel
};

export * from "./propertiesPanelId";

// Export framework
export * from "./framework";

// Export schemas
export * from "./schemas";
