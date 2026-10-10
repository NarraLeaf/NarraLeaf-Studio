import React, { useCallback, useMemo, useSyncExternalStore } from "react";
import { Bot, Check, CirclePause } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { ContextMenu, useContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { Services } from "@/lib/workspace/services/services";
import type { AgentFollowService, AgentFollowState } from "@/lib/workspace/services/agent/AgentFollowService";
import { useWorkspace } from "../../context/WorkspaceContext";
import { StatusEntry } from "../status-bar/StatusEntry";

const NO_SUBSCRIPTION = () => () => {};

/**
 * The agent working in this project, in one status bar cell: what it is editing while a call runs,
 * which client it is between calls, and that it is paused when the author paused it. The cell's menu
 * holds the author's two switches - pause, and follow.
 *
 * Silent until an agent has called this window, so a project nobody connects an agent to never
 * shows it.
 *
 * Comments in English per project convention.
 */
export function AgentStatusEntry() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const follow = context ? context.services.get<AgentFollowService>(Services.AgentFollow) : null;
    const subscribe = useCallback(
        (listener: () => void) => (follow ? follow.onChanged(listener) : NO_SUBSCRIPTION()),
        [follow],
    );
    const state = useSyncExternalStore<AgentFollowState | null>(subscribe, () => follow?.getState() ?? null);
    const { menuState, showMenu, hideMenu } = useContextMenu();

    const menu = useMemo<ContextMenuDef>(() => {
        if (!follow || !state) {
            return [];
        }
        return [
            {
                id: "agent-pause",
                label: t(state.paused ? "workspace.agent.menu.resume" : "workspace.agent.menu.pause"),
                onClick: () => follow.setPaused(!state.paused),
            },
            {
                id: "agent-follow",
                label: t("workspace.agent.menu.follow"),
                icon: state.follow ? <Check className="h-3 w-3" /> : undefined,
                onClick: () => follow.setFollow(!state.follow),
            },
        ];
    }, [follow, state, t]);

    if (!follow || !state || (state.clientName === null && state.activity === null && !state.paused)) {
        return null;
    }

    const label = state.paused
        ? t("workspace.agent.status.paused")
        : state.activity
            ? state.activity.target
                ? t("workspace.agent.status.editing", { name: state.activity.target })
                : t("workspace.agent.status.working")
            : t("workspace.agent.status.connected", { client: state.clientName ?? "MCP" });

    return (
        <>
            <StatusEntry
                onClick={showMenu}
                tooltip={t("workspace.agent.tooltip")}
                emphasis={state.paused || state.activity !== null}
                dataAttributes={{ "data-agent-status": state.paused ? "paused" : state.activity ? "busy" : "idle" }}
            >
                {state.paused ? <CirclePause className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                <span>{label}</span>
            </StatusEntry>
            <ContextMenu
                items={menu}
                iconsEnabled
                position={menuState.position}
                onClose={hideMenu}
                visible={menuState.visible}
            />
        </>
    );
}
