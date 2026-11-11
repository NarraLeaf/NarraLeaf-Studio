import { useCallback, useSyncExternalStore } from "react";
import { Bot } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import { useWorkspace } from "../../context/WorkspaceContext";
import { StatusEntry } from "../status-bar/StatusEntry";

const NO_SUBSCRIPTION = () => () => {};

/**
 * Says that an agent's play-test holds this project's Dev Mode, so the author knows why the window
 * did not appear and why it takes no input when shown. Clicking it shows the window.
 *
 * Silent unless an agent holds the session: the author's own Dev Mode runs are the run cell's.
 *
 * Comments in English per project convention.
 */
export function AgentDevModeEntry() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const devMode = context ? context.services.get<DevModeService>(Services.DevMode) : null;
    const subscribe = useCallback(
        (listener: () => void) => (devMode ? devMode.onAgentHeldChanged(listener) : NO_SUBSCRIPTION()),
        [devMode],
    );
    const held = useSyncExternalStore(subscribe, () => devMode?.isAgentHeld() ?? false);

    if (!devMode || !held) {
        return null;
    }

    return (
        <StatusEntry
            emphasis
            onClick={() => void devMode.reveal()}
            tooltip={t("workspace.agent.devMode.tooltip")}
            dataAttributes={{ "data-agent-devmode": "held" }}
        >
            <Bot className="h-3 w-3" />
            <span>{t("workspace.agent.devMode.status")}</span>
        </StatusEntry>
    );
}
