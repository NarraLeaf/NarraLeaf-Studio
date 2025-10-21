import { RendererInterfaceKey } from "@shared/types/constants";
import { Namespace } from "@shared/types/ipc";
import { IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { IPCClient } from "./ipcClient";
import { WindowAppType, WindowLuanchOptions, WindowProps } from "@shared/types/window";

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
    fs: {
        stat: (path: string) => ipcClient.invoke(IPCEventType.fsStat, { path }),
        list: (path: string) => ipcClient.invoke(IPCEventType.fsList, { path }),
        details: (path: string) => ipcClient.invoke(IPCEventType.fsDetails, { path }),
        requestRead: (path: string, encoding: BufferEncoding) => ipcClient.invoke(IPCEventType.fsRequestRead, { path, encoding, raw: false }),
        requestReadRaw: (path: string) => ipcClient.invoke(IPCEventType.fsRequestRead, { path, raw: true }),
        requestWrite: (path: string, encoding: BufferEncoding) => ipcClient.invoke(IPCEventType.fsRequestWrite, { path, encoding, raw: false }),
        requestWriteRaw: (path: string) => ipcClient.invoke(IPCEventType.fsRequestWrite, { path, raw: true }),
        createDir: (path: string) => ipcClient.invoke(IPCEventType.fsCreateDir, { path }),
        deleteFile: (path: string) => ipcClient.invoke(IPCEventType.fsDeleteFile, { path }),
        deleteDir: (path: string) => ipcClient.invoke(IPCEventType.fsDeleteDir, { path }),
        rename: (oldPath: string, newName: string, isDir: boolean) => ipcClient.invoke(IPCEventType.fsRename, { oldPath, newName, isDir }),
        copyFile: (src: string, dest: string) => ipcClient.invoke(IPCEventType.fsCopyFile, { src, dest }),
        copyDir: (src: string, dest: string) => ipcClient.invoke(IPCEventType.fsCopyDir, { src, dest }),
        moveFile: (src: string, dest: string) => ipcClient.invoke(IPCEventType.fsMoveFile, { src, dest }),
        moveDir: (src: string, dest: string) => ipcClient.invoke(IPCEventType.fsMoveDir, { src, dest }),
        isFileExists: (path: string) => ipcClient.invoke(IPCEventType.fsFileExists, { path }),
        isDirExists: (path: string) => ipcClient.invoke(IPCEventType.fsDirExists, { path }),
        isFile: (path: string) => ipcClient.invoke(IPCEventType.fsIsFile, { path }),
        isDir: (path: string) => ipcClient.invoke(IPCEventType.fsIsDir, { path }),
    },
    launchSettings: (props: WindowProps[WindowAppType.Settings]) => ipcClient.invoke(IPCEventType.appLaunchSettings, { props }),
};
