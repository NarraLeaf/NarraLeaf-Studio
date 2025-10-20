import { AppInfo } from "./app";
import { IPCMessageType, IPCType } from "./ipc";
import { PlatformInfo } from "./os";
import { WindowAppType, WindowProps, WindowVisibilityStatus } from "./window";

export enum IPCEventType {
    getPlatform = "getPlatform",
    appTerminate = "app.terminate",
    appWindowControl = "app.window.setControl",
    appWindowGetControl = "app.window.getControl",
    appWindowProps = "app.window.props",
    appInfo = "app.info",
    appWindowReady = "app.window.ready",
}

export type VoidRequestStatus = RequestStatus<void>;
export type RequestStatus<T> = {
    success: true;
    data: T;
    error?: never;
} | {
    success: false;
    data?: never;
    error?: string;
};

export type IPCEvents = {
    [IPCEventType.getPlatform]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: PlatformInfo;
    };
    [IPCEventType.appTerminate]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {
            err: string | null;
        },
        response: never;
    };
    [IPCEventType.appWindowControl]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            control: "minimize" | "maximize" | "unmaximize" | "close",
        },
        response: void;
    };
    [IPCEventType.appWindowGetControl]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            status: WindowVisibilityStatus,
        };
    };
    [IPCEventType.appWindowProps]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: WindowProps[WindowAppType];
    };
    [IPCEventType.appInfo]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: AppInfo;
    };
    [IPCEventType.appWindowReady]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {},
        response: never;
    };
};
