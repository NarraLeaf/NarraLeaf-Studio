/**
 * The Fetch node's request, for a Dev Mode preview.
 *
 * The preview renderer is confined to the app protocol whenever the project's Allow HTTP setting is
 * off (see `devModeNetworkPolicy`), so a request issued from there would be cancelled. This channel
 * issues it from the main process instead - which is also the only place the timeout, the size cap
 * and the scheme check can be enforced, and the only origin that is not subject to CORS.
 *
 * Being outside that cage is exactly why the check below is not optional. The renderer sends what to
 * request; whether it may is read here, from the project on disk, using the same reader the policy
 * itself uses. A flag passed in by the caller would make this channel a way around the setting.
 *
 * Comments in English per project convention.
 */

import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type { BlueprintNetworkFetchResult } from "@shared/types/blueprint/network";
import { executeBlueprintNetworkFetch } from "@shared/utils/blueprintNetworkFetch";
import { readProjectAllowHttp } from "../../devMode/devModeNetworkPolicy";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class BlueprintNetworkFetchHandler extends IPCHandler<IPCEventType.blueprintNetworkFetch> {
    readonly name = IPCEventType.blueprintNetworkFetch;
    readonly type = IPCMessageType.request;

    public async handle(
        _window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintNetworkFetch]["data"],
    ): Promise<RequestStatus<{ result: BlueprintNetworkFetchResult }>> {
        try {
            const allowHttp = await readProjectAllowHttp(data.projectPath);
            const result = await executeBlueprintNetworkFetch(data.request, { allowHttp });
            // Always a success envelope: a refused or failed request is a result the node branches
            // on, not an IPC failure. Reporting it as one would surface a toast about Studio
            // malfunctioning for a server that was simply down.
            return this.success({ result });
        } catch (err) {
            return this.failed(err);
        }
    }
}
