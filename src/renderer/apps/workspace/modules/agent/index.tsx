import { Bot } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { AGENT_LOG_PANEL_ID } from "./agentLogIds";
import { AgentLogPanel } from "./AgentLogPanel";

/**
 * The Agent log panel, in the bottom dock: every call an agent connected over MCP made in this
 * workspace, kept in view beside the Console while the agent works.
 */
export const agentLogPanelModule: PanelModule = {
    metadata: {
        id: AGENT_LOG_PANEL_ID,
        titleKey: "placeholders.moduleTitles.agentLog",
        get title() {
            return translate("placeholders.moduleTitles.agentLog");
        },
        icon: <Bot className="w-4 h-4" />,
        position: PanelPosition.Bottom,
        defaultVisible: false,
        // After the Console (0) and Problems (1).
        order: 2,
    },
    component: AgentLogPanel,
};
