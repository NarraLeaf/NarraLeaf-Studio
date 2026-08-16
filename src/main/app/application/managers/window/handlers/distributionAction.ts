import { createProjectMaterial } from "@narraleaf/encryption";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Minting the project's distribution key.
 *
 * Here rather than in the renderer because the value comes from the protection
 * component, which is a host-process dependency; and because a value that the
 * project keeps for years should be produced in one place, not wherever a form
 * happens to run.
 *
 * There is deliberately no read: the manifest the renderer already holds is the
 * only copy, and no screen shows it.
 */
export class DistributionCreateKeyHandler extends IPCHandler<IPCEventType.distributionCreateKey> {
    readonly name = IPCEventType.distributionCreateKey;
    readonly type = IPCMessageType.request;

    public async handle(
        _window: AppWindow,
    ): Promise<RequestStatus<IPCEvents[IPCEventType.distributionCreateKey]["response"]>> {
        return this.tryUse(async () => ({ key: createProjectMaterial() }));
    }
}
