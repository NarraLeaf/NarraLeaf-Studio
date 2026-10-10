import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getInterface } from "@/lib/app/bridge";
import { revealInFileManagerKey } from "@/lib/app/platform";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { AgentFollowService, AgentFollowState } from "@/lib/workspace/services/agent/AgentFollowService";
import type { AgentCopyConfigKind, AgentQuickState, AgentQuickTogglePatch } from "@shared/agent/workspaceAccess";
import { useRegistry } from "@/apps/workspace/registry";
import { useWorkspace } from "../../context";
import { AGENT_MENU_GROUP_ID, agentCopyKindLabel, agentMenuStateKind, buildAgentMenuItems } from "./agentMenuModel";
import { AGENT_LOG_PANEL_ID } from "./agentLogIds";

/** The setting row Settings opens at for agent access (`appSettings.ts`). */
const AGENT_ACCESS_SETTING_KEY = "agent.access";

/** In the in-app menu bar between Edit (20) and Help (30); on macOS the native bar puts it before Develop. */
const AGENT_MENU_ORDER = 25;

const NO_SUBSCRIPTION = () => () => {};

/**
 * Agent access as main reports it: whether it is on, writes or full access are allowed and the endpoint listens.
 * Null until main answers. Kept current by main's broadcast, which follows every change - from this
 * menu, another window's menu, the Settings window, or the endpoint starting or failing.
 */
function useAgentQuickState(): [AgentQuickState | null, (state: AgentQuickState) => void] {
    const [state, setState] = useState<AgentQuickState | null>(null);
    useEffect(() => {
        let alive = true;
        const agent = getInterface().agent;
        void agent.getQuickState().then(result => {
            if (alive && result.success) {
                setState(result.data);
            }
        }).catch(() => undefined);
        const token = agent.onQuickStateChanged(next => setState(next));
        return () => {
            alive = false;
            token.cancel();
        };
    }, []);
    return [state, setState];
}

/**
 * The Agent menu, registered as a top-level group: on macOS it is synced to the native menu bar
 * (before Develop), elsewhere it is a menu on the in-app bar or a row of the hamburger menu.
 *
 * Re-registered when what it shows changes - which is rare, because it is keyed on the status
 * line's words rather than on every call the agent makes.
 *
 * Comments in English per project convention.
 */
export function AgentMenu() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { registerActionGroup, unregisterActionGroup } = useRegistry();
    const [quick, setQuick] = useAgentQuickState();

    let follow: AgentFollowService | null = null;
    try {
        follow = context ? context.services.get<AgentFollowService>(Services.AgentFollow) : null;
    } catch {
        follow = null;
    }
    const subscribe = useCallback(
        (listener: () => void) => (follow ? follow.onChanged(listener) : NO_SUBSCRIPTION()),
        [follow],
    );
    const followState = useSyncExternalStore<AgentFollowState | null>(subscribe, () => follow?.getState() ?? null);
    const paused = followState?.paused ?? false;
    const following = followState?.follow ?? true;
    const clientName = followState?.clientName ?? null;
    const state = agentMenuStateKind(quick, { paused, busy: followState?.active ?? false });

    const notify = useCallback((message: string, tone: "success" | "error", actions?: { label: string; onClick: () => void }[]) => {
        context?.services.get<UIService>(Services.UI).showNotification(message, tone, actions ? { actions } : undefined);
    }, [context]);

    const toggle = useCallback((patch: AgentQuickTogglePatch) => {
        void (async () => {
            const result = await getInterface().agent.quickToggle(patch);
            if (result.success) {
                setQuick(result.data);
            } else {
                notify(t("workspace.agent.appMenu.notice.toggleFailed", { error: result.error ?? "" }), "error");
            }
        })();
    }, [notify, setQuick, t]);

    const copyConfig = useCallback((kind: AgentCopyConfigKind) => {
        void (async () => {
            const result = await getInterface().agent.copyConfig(kind);
            if (result.success) {
                notify(t("workspace.agent.appMenu.notice.copied", { client: agentCopyKindLabel(kind) }), "success");
            } else {
                notify(t("workspace.agent.appMenu.notice.copyFailed", { error: result.error ?? "" }), "error");
            }
        })();
    }, [notify, t]);

    const exportSkill = useCallback(() => {
        void (async () => {
            const result = await getInterface().agent.exportSkill();
            if (!result.success) {
                notify(t("workspace.agent.appMenu.notice.exportFailed", { error: result.error ?? "" }), "error");
                return;
            }
            if (result.data.canceled) {
                return;
            }
            notify(t("workspace.agent.appMenu.notice.exported", { path: result.data.path }), "success", [{
                label: t(revealInFileManagerKey()),
                onClick: () => {
                    void getInterface().agent.revealExportedSkill();
                },
            }]);
        })();
    }, [notify, t]);

    const items = useMemo(() => {
        if (!follow) {
            return null;
        }
        const service = follow;
        return buildAgentMenuItems({
            t,
            clientName,
            state,
            paused,
            follow: following,
            quick,
            run: {
                togglePause: () => service.setPaused(!service.getState().paused),
                toggleFollow: () => service.setFollow(!service.getState().follow),
                openLog: () => context?.services.get<UIService>(Services.UI).panels.show(AGENT_LOG_PANEL_ID),
                toggleEnabled: () => toggle({ enabled: !(quick?.enabled ?? false) }),
                toggleAllowWrites: () => toggle({ allowWrites: !(quick?.allowWrites ?? false) }),
                toggleFullAccess: () => toggle({ fullAccess: !(quick?.fullAccess ?? false) }),
                copyConfig,
                exportSkill,
                openSettings: () => {
                    void getInterface().app.launchSettings({ highlight: AGENT_ACCESS_SETTING_KEY });
                },
            },
        });
    }, [clientName, context, copyConfig, exportSkill, follow, following, paused, quick, state, t, toggle]);

    useEffect(() => {
        if (!items) {
            return;
        }
        registerActionGroup({
            id: AGENT_MENU_GROUP_ID,
            label: t("workspace.agent.appMenu.title"),
            labelKey: "workspace.agent.appMenu.title",
            order: AGENT_MENU_ORDER,
            menuSlot: "top-level",
            items,
        });
        return () => unregisterActionGroup(AGENT_MENU_GROUP_ID);
    }, [items, registerActionGroup, t, unregisterActionGroup]);

    return null;
}
