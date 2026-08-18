import { Puzzle } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { PluginsPanel } from "./PluginsPanel";
import { PLUGINS_PANEL_ID, type PluginsPanelPayload } from "./openPluginsPanel";

/** Left-dock plugin manager: install, authorize, switch on and off, without leaving the project. */
export const pluginsPanelModule: PanelModule<PluginsPanelPayload> = {
  metadata: {
    id: PLUGINS_PANEL_ID,
    // Resolved lazily on read (module registration runs after i18n init).
    titleKey: "placeholders.moduleTitles.plugins",
    get title() {
      return translate("placeholders.moduleTitles.plugins");
    },
    icon: <Puzzle className="w-4 h-4" />,
    position: PanelPosition.Left,
    defaultVisible: false,
    // Below the content panels: plugins are a property of the installation, like the project
    // settings above them, not something an author reaches for while writing.
    order: 40
  },
  component: PluginsPanel
};

export { PluginsPanel };
export { openPluginsPanel, PLUGINS_PANEL_ID } from "./openPluginsPanel";
export type { PluginsPanelPayload };
