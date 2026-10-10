import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { WindowAppType } from "@shared/types/window";
import type { AgentSettingsSnapshot } from "@shared/agent/settings";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * The Settings window's hold on agent access.
 *
 * Every handler here refuses every other window, reading included. Reading hands out the bearer
 * token, and the rest decide whether an outside program may change the author's projects; a
 * workspace shows project content and runs plugin code, so it is the one window that must never be
 * able to switch agent writes on, or learn the token that would let something else in. The same
 * rule, for the same reason, as the project-trust ledger's writers.
 */
function refuseOutsideSettings(window: AppWindow, action: string): Error | null {
    const windowType = window.getWindowType();
    if (windowType === WindowAppType.Settings) {
        return null;
    }
    window.app.logger.warn(`[Agent] Refused to ${action} for a ${windowType} window`);
    return new Error(`Agent access is managed from Settings; a ${windowType} window cannot ${action}.`);
}

export class AgentSettingsGetHandler extends IPCHandler<IPCEventType.agentSettingsGet> {
    readonly name = IPCEventType.agentSettingsGet;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<AgentSettingsSnapshot>> {
        const refused = refuseOutsideSettings(window, "read agent access");
        if (refused) {
            return this.failed(refused);
        }
        try {
            return this.success(await window.getApp().getAgentManager().snapshot());
        } catch (error) {
            return this.failed(error);
        }
    }
}

export class AgentSettingsUpdateHandler extends IPCHandler<IPCEventType.agentSettingsUpdate> {
    readonly name = IPCEventType.agentSettingsUpdate;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        patch: IPCEvents[IPCEventType.agentSettingsUpdate]["data"],
    ): Promise<RequestStatus<AgentSettingsSnapshot>> {
        const refused = refuseOutsideSettings(window, "change agent access");
        if (refused) {
            return this.failed(refused);
        }
        try {
            // The window goes along so that turning full access on is confirmed in a dialog on it.
            return this.success(await window.getApp().getAgentManager().updateSettings(patch ?? {}, window));
        } catch (error) {
            return this.failed(error);
        }
    }
}

export class AgentSettingsRegenerateTokenHandler extends IPCHandler<IPCEventType.agentSettingsRegenerateToken> {
    readonly name = IPCEventType.agentSettingsRegenerateToken;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<AgentSettingsSnapshot>> {
        const refused = refuseOutsideSettings(window, "replace the agent token");
        if (refused) {
            return this.failed(refused);
        }
        try {
            return this.success(await window.getApp().getAgentManager().regenerateToken());
        } catch (error) {
            return this.failed(error);
        }
    }
}

export class AgentSettingsAddImportRootHandler extends IPCHandler<IPCEventType.agentSettingsAddImportRoot> {
    readonly name = IPCEventType.agentSettingsAddImportRoot;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<AgentSettingsSnapshot>> {
        const refused = refuseOutsideSettings(window, "allow an import folder");
        if (refused) {
            return this.failed(refused);
        }
        try {
            return this.success(await window.getApp().getAgentManager().addImportRoot(window));
        } catch (error) {
            return this.failed(error);
        }
    }
}
