import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";


export class AppEditorLaunchHandler extends IPCHandler<IPCEventType.editorLaunch> {
    readonly name = IPCEventType.editorLaunch;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow, { props, closeCurrentWindow }: IPCEvents[IPCEventType.editorLaunch]["data"]): Promise<RequestStatus<void>> {
        const editorWindow = await window.getApp().launchWorkspace(window, props, {
            minWidth: 400,
            minHeight: 400,
            width: 1200,
            height: 700,
        });

        editorWindow.onReady(() => {
            if (closeCurrentWindow) {
                window.close();
            }
        });

        return this.success(void 0);
    }
}