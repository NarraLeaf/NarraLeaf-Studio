import { FileDetails, FileStat } from "@shared/utils/fs";
import { AppInfo } from "./app";
import { RendererInterfaceKey } from "./constants";
import { RequestStatus } from "./ipcEvents";
import { FsRequestResult, PlatformInfo } from "./os";
import { WindowAppType, WindowProps, WindowVisibilityStatus } from "./window";
import { GlobalStateValue } from "./state/globalState";
import { GlobalStateKeys } from "./state/globalState";

export interface RendererPreloadedInterface {
    getPlatform(): Promise<RequestStatus<PlatformInfo>>;
    getAppInfo(): Promise<RequestStatus<AppInfo>>;
    getWindowProps<T extends WindowAppType>(): Promise<RequestStatus<WindowProps[T]>>;
    terminate(err?: string): Promise<void>;
    window: {
        ready(): void;
        control: {
            minimize(): Promise<RequestStatus<void>>;
            maximize(): Promise<RequestStatus<void>>;
            unmaximize(): Promise<RequestStatus<void>>;
            close(): Promise<RequestStatus<void>>;
            status(): Promise<RequestStatus<{ status: WindowVisibilityStatus }>>;
        };
    };
    fs: {
        stat(path: string): Promise<RequestStatus<FsRequestResult<FileStat>>>;
        list(path: string): Promise<RequestStatus<FsRequestResult<FileStat[]>>>;
        details(path: string): Promise<RequestStatus<FsRequestResult<FileDetails>>>;
        requestRead(path: string, encoding: BufferEncoding): Promise<RequestStatus<FsRequestResult<string>>>;
        requestReadRaw(path: string): Promise<RequestStatus<FsRequestResult<string>>>;
        requestWrite(path: string, encoding: BufferEncoding): Promise<RequestStatus<FsRequestResult<string>>>;
        requestWriteRaw(path: string): Promise<RequestStatus<FsRequestResult<string>>>;
        createDir(path: string): Promise<RequestStatus<FsRequestResult<void>>>;
        deleteFile(path: string): Promise<RequestStatus<FsRequestResult<void>>>;
        deleteDir(path: string): Promise<RequestStatus<FsRequestResult<void>>>;
        rename(oldPath: string, newName: string, isDir: boolean): Promise<RequestStatus<FsRequestResult<void>>>;
        copyFile(src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        copyDir(src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        moveFile(src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        moveDir(src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        isFileExists(path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        isDirExists(path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        isFile(path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        isDir(path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
    };
    state: {
        getGlobalState<K extends GlobalStateKeys>(key: K): Promise<RequestStatus<GlobalStateValue<K>>>;
        setGlobalState<K extends GlobalStateKeys>(key: K, value: GlobalStateValue<K>): Promise<RequestStatus<void>>;
    }
    launchSettings(props: WindowProps[WindowAppType.Settings]): Promise<RequestStatus<void>>;
}

declare global {
    interface Window {
        [RendererInterfaceKey]: RendererPreloadedInterface;
    }
}
