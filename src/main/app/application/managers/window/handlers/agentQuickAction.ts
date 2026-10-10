import { clipboard } from "electron";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { WindowAppType } from "@shared/types/window";
import { AGENT_COPY_CONFIG_KINDS, toAgentQuickState, type AgentQuickState, type AgentQuickTogglePatch } from "@shared/agent/workspaceAccess";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * The workspace's Agent menu: a narrow door onto agent access that the Settings-only handlers in
 * `agentSettingsAction.ts` keep shut.
 *
 * Those refuse every window but Settings because reading hands out the bearer token. These answer a
 * workspace too, and so nothing they return can carry a secret: state is projected through
 * `toAgentQuickState` (three booleans), a client configuration is written to the system clipboard
 * here in main and only `{ copied: true }` goes back, and the skill export answers the folder it
 * wrote. Turning write access on is confirmed in a native dialog by `AgentManager.quickToggle`,
 * because a workspace runs plugin code.
 *
 * Game windows (Dev Mode, Preview) run project code and are refused, as is everything else that is
 * not a workspace or the Settings window.
 */
function refuseOutsideWorkspace(window: AppWindow, action: string): Error | null {
    const windowType = window.getWindowType();
    if (windowType === WindowAppType.Workspace || windowType === WindowAppType.Settings) {
        return null;
    }
    window.app.logger.warn(`[Agent] Refused to ${action} for a ${windowType} window`);
    return new Error(`A ${windowType} window cannot ${action}.`);
}

export class AgentQuickStateHandler extends IPCHandler<IPCEventType.agentQuickState> {
    readonly name = IPCEventType.agentQuickState;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<AgentQuickState>> {
        const refused = refuseOutsideWorkspace(window, "read agent access");
        if (refused) {
            return this.failed(refused);
        }
        try {
            return this.success(toAgentQuickState(await window.getApp().getAgentManager().snapshot()));
        } catch (error) {
            return this.failed(error);
        }
    }
}

export class AgentQuickToggleHandler extends IPCHandler<IPCEventType.agentQuickToggle> {
    readonly name = IPCEventType.agentQuickToggle;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        patch: IPCEvents[IPCEventType.agentQuickToggle]["data"],
    ): Promise<RequestStatus<AgentQuickState>> {
        const refused = refuseOutsideWorkspace(window, "change agent access");
        if (refused) {
            return this.failed(refused);
        }
        // Only the two switches the menu holds, and only as booleans: the port and the import
        // folders stay with the Settings window.
        const clean: AgentQuickTogglePatch = {};
        if (typeof patch?.enabled === "boolean") {
            clean.enabled = patch.enabled;
        }
        if (typeof patch?.allowWrites === "boolean") {
            clean.allowWrites = patch.allowWrites;
        }
        try {
            return this.success(toAgentQuickState(await window.getApp().getAgentManager().quickToggle(window, clean)));
        } catch (error) {
            return this.failed(error);
        }
    }
}

export class AgentCopyConfigHandler extends IPCHandler<IPCEventType.agentCopyConfig> {
    readonly name = IPCEventType.agentCopyConfig;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { kind }: IPCEvents[IPCEventType.agentCopyConfig]["data"],
    ): Promise<RequestStatus<{ copied: true }>> {
        const refused = refuseOutsideWorkspace(window, "copy an agent configuration");
        if (refused) {
            return this.failed(refused);
        }
        if (!AGENT_COPY_CONFIG_KINDS.includes(kind)) {
            return this.failed(new Error(`Unknown configuration kind: ${String(kind)}`));
        }
        try {
            clipboard.writeText(await window.getApp().getAgentManager().clientConfig(kind));
            return this.success({ copied: true as const });
        } catch (error) {
            return this.failed(error);
        }
    }
}

export class AgentExportSkillHandler extends IPCHandler<IPCEventType.agentExportSkill> {
    readonly name = IPCEventType.agentExportSkill;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<IPCEvents[IPCEventType.agentExportSkill]["response"]>> {
        const refused = refuseOutsideWorkspace(window, "export the agent skill");
        if (refused) {
            return this.failed(refused);
        }
        try {
            return this.success(await window.getApp().getAgentManager().exportSkill(window));
        } catch (error) {
            return this.failed(error);
        }
    }
}

export class AgentRevealExportedSkillHandler extends IPCHandler<IPCEventType.agentRevealExportedSkill> {
    readonly name = IPCEventType.agentRevealExportedSkill;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ revealed: boolean }>> {
        const refused = refuseOutsideWorkspace(window, "show the exported agent skill");
        if (refused) {
            return this.failed(refused);
        }
        try {
            return this.success({ revealed: window.getApp().getAgentManager().revealExportedSkill(window) });
        } catch (error) {
            return this.failed(error);
        }
    }
}
