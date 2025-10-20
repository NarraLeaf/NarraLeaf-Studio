import { RendererInterfaceKey } from "@shared/types/constants";
import { Namespace } from "@shared/types/ipc";
import { IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { IPCClient } from "./ipcClient";
import { WindowAppType, WindowProps } from "@shared/types/window";

export const ipcClient = new IPCClient(Namespace.NarraLeafStudio);
export const IPCInterface: Window[typeof RendererInterfaceKey] = {
    getPlatform: () => ipcClient.invoke(IPCEventType.getPlatform, {}),
    getAppInfo: () => ipcClient.invoke(IPCEventType.appInfo, {}),
    getWindowProps: <T extends WindowAppType>(): Promise<RequestStatus<WindowProps[T]>> => ipcClient.invoke(IPCEventType.appWindowProps, {}),
    terminate: async (err?: string) => ipcClient.send(IPCEventType.appTerminate, { err: err ?? null }),
    window: {
        ready: () => ipcClient.send(IPCEventType.appWindowReady, {}),
        control: {
            minimize: () => ipcClient.invoke(IPCEventType.appWindowControl, { control: "minimize" }),
            maximize: () => ipcClient.invoke(IPCEventType.appWindowControl, { control: "maximize" }),
            unmaximize: () => ipcClient.invoke(IPCEventType.appWindowControl, { control: "unmaximize" }),
            close: () => ipcClient.invoke(IPCEventType.appWindowControl, { control: "close" }),
            status: () => ipcClient.invoke(IPCEventType.appWindowGetControl, {}),
        },
    },
};
