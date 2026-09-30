/**
 * The Fetch node's request, for a Dev Mode preview.
 *
 * The preview renderer is confined to the app protocol whenever the project's Allow HTTP setting is
 * off (see `devModeNetworkPolicy`), so a request issued from there would be cancelled. This channel
 * issues it from the main process instead - which is also the only place the timeout, the size cap
 * and the scheme check can be enforced, and the only origin that is not subject to CORS.
 *
 * Being outside that cage is exactly why the checks below are not optional. The renderer sends what
 * to request; whether it may - the setting, and the allowlist when the project states one - is read
 * here, from the project on disk, using the same reader the policy itself uses. A flag passed in by
 * the caller would make this channel a way around both.
 *
 * *Which* project is read is the same question one step earlier, and it is answered by the window
 * rather than by the payload. The settings file names the hosts a project may reach, so a caller
 * free to name the project was a caller free to pick the permissions it would be judged by: name any
 * directory on the disk whose `.nlproj` says Allow HTTP, and this channel would honour that
 * project's list while acting for a window that has a different project open - one whose author may
 * have turned the whole of the network off. Reading the setting off disk only enforces it if the
 * project is the caller's own, which is what {@link requireWindowProject} establishes.
 *
 * Comments in English per project convention.
 */

import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type { BlueprintNetworkFetchResult } from "@shared/types/blueprint/network";
import { executeBlueprintNetworkFetch } from "@shared/utils/blueprintNetworkFetch";
import { readProjectNetworkSettings } from "../../devMode/devModeNetworkPolicy";
import { refuseDistrustedWindow } from "../../../utils/projectTrustGate";
import { requireWindowProject } from "../../../utils/windowProject";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class BlueprintNetworkFetchHandler extends IPCHandler<IPCEventType.blueprintNetworkFetch> {
    readonly name = IPCEventType.blueprintNetworkFetch;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintNetworkFetch]["data"],
    ): Promise<RequestStatus<{ result: BlueprintNetworkFetchResult }>> {
        try {
            // The window's project, not the payload's. A mismatch throws, and it leaves through
            // `failed` below carrying its own code rather than as a network result: a request this
            // channel refuses to consider is not a request that failed, and the node's error branch
            // is for servers that did not answer.
            const projectPath = requireWindowProject(window, data.projectPath);
            // A distrusted project reaches nothing: not through its own renderer, which the session
            // hook cuts off, and not through this channel, which exists to issue requests from
            // outside that cage. Refused as an IPC failure for the reason a mismatch is - it is
            // not a request that failed, it is one this channel will not consider.
            const distrusted = refuseDistrustedWindow(window, "network request");
            if (distrusted) {
                throw new Error(distrusted);
            }
            const { allowHttp, allowlist } = await readProjectNetworkSettings(projectPath);
            // `check` because this process can follow the chain itself, which is what makes the
            // allowlist a statement about where the bytes came from rather than about what was
            // typed. Dev Mode has to answer the way the packaged game does or it is not a preview.
            const result = await executeBlueprintNetworkFetch(data.request, {
                allowHttp,
                allowlist,
                redirects: "check",
            });
            // A request that was performed always answers with a success envelope: refused by the
            // allowlist, timed out or answered 500, all of it is a result the node branches on
            // rather than an IPC failure. Reporting one as an IPC failure would surface a toast
            // about Studio malfunctioning for a server that was simply down.
            return this.success({ result });
        } catch (err) {
            return this.failed(err);
        }
    }
}
