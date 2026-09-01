import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { clearBlueprintPersistence } from "./blueprintPersistenceAction";
import { clearDevModeSaves } from "./devModeSaveAction";
import { IPCHandler } from "./IPCHandler";

/**
 * Clear one project's Dev Mode player data - every save slot and the persistence store.
 *
 * The two live apart on disk (saves as one file per slot, persistence as an electron-store), so this
 * calls the owner of each rather than reaching into their layouts. Saves are cleared first: a failure
 * partway leaves the smaller, purely additive half (persistence) untouched rather than the reverse.
 */
export class DevModeDataResetHandler extends IPCHandler<IPCEventType.devModeDataReset> {
    readonly name = IPCEventType.devModeDataReset;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.devModeDataReset]["data"],
    ): Promise<RequestStatus<void>> {
        return this.tryUse(async () => {
            await clearDevModeSaves(window, data.projectRef);
            clearBlueprintPersistence(window, data.projectRef);
        });
    }
}
