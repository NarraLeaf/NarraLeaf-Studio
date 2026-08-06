import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import type { RemoteAssetFetchResult } from "@shared/types/remoteAsset";
import { fetchRemoteAsset } from "../../remoteAssetFetcher";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Fetch a remote asset's bytes on the renderer's behalf.
 *
 * There is no capability gate: this reads a URL the author typed and returns the bytes, touching
 * nothing on the machine. The things worth gating - where those bytes are then written - are on the
 * privileged file-system facade the renderer already has to go through.
 */
export class AssetFetchRemoteHandler extends IPCHandler<IPCEventType.assetFetchRemote> {
    readonly name = IPCEventType.assetFetchRemote;
    readonly type = IPCMessageType.request;

    public async handle(
        _window: AppWindow,
        data: IPCEvents[IPCEventType.assetFetchRemote]["data"],
    ): Promise<RequestStatus<RemoteAssetFetchResult>> {
        return this.tryUse(() => fetchRemoteAsset(data.url, data.validators));
    }
}
