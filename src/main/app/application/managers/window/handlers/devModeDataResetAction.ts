import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { requireWindowProjectStore } from "../../../utils/windowProjectStore";
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
 *
 * Which project is the window's, and so is the identifier its stores are named by - the sharpest of
 * the Dev Mode store requests, since it deletes a whole directory. See `requireWindowProjectStore`.
 */
export class DevModeDataResetHandler extends IPCHandler<IPCEventType.devModeDataReset> {
    readonly name = IPCEventType.devModeDataReset;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.devModeDataReset]["data"],
    ): Promise<RequestStatus<void>> {
        return this.tryUse(async () => {
            const projectRef = await requireWindowProjectStore(window, data.projectRef);
            await clearDevModeSaves(window, projectRef);
            clearBlueprintPersistence(window, projectRef);
        });
    }
}
