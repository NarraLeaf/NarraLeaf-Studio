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
 * Comments in English per project convention.
 */

import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type { BlueprintNetworkFetchResult } from "@shared/types/blueprint/network";
import { executeBlueprintNetworkFetch } from "@shared/utils/blueprintNetworkFetch";
import { readProjectNetworkSettings } from "../../devMode/devModeNetworkPolicy";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class BlueprintNetworkFetchHandler extends IPCHandler<IPCEventType.blueprintNetworkFetch> {
  readonly name = IPCEventType.blueprintNetworkFetch;
  readonly type = IPCMessageType.request;

  public async handle(
    _window: AppWindow,
    data: IPCEvents[IPCEventType.blueprintNetworkFetch]["data"]
  ): Promise<RequestStatus<{ result: BlueprintNetworkFetchResult }>> {
    try {
      const { allowHttp, allowlist } = await readProjectNetworkSettings(data.projectPath);
      // `check` because this process can follow the chain itself, which is what makes the
      // allowlist a statement about where the bytes came from rather than about what was
      // typed. Dev Mode has to answer the way the packaged game does or it is not a preview.
      const result = await executeBlueprintNetworkFetch(data.request, {
        allowHttp,
        allowlist,
        redirects: "check"
      });
      // Always a success envelope: a refused or failed request is a result the node branches
      // on, not an IPC failure. Reporting it as one would surface a toast about Studio
      // malfunctioning for a server that was simply down.
      return this.success({ result });
    } catch (err) {
      return this.failed(err);
    }
  }
}
