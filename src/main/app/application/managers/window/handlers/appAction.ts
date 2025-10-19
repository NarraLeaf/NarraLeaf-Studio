import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler, IPCHandlerProps } from "./IPCHandler";

export class AppTerminateHandler extends IPCHandler<IPCEventType.appTerminate> {
    readonly name = IPCEventType.appTerminate;
    readonly type = IPCMessageType.message;

    public handle(window: AppWindow, {err}: IPCHandlerProps<IPCEventType.appTerminate>) {
        if (err) {
            const timestamp = new Date().toISOString();
            window.app.logger.error(`The App is terminating due to an error: ${err}`);
            window.app.logger.error(`App Crashed at ${timestamp}`);
            window.app.crash(err);
        } else {
            window.app.quit();
        }
        return { success: true, data: null as never };
    }
}
