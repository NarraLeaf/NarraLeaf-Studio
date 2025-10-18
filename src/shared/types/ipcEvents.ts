import { IPCMessageType, IPCType } from "./ipc";
import { PlatformInfo } from "./os";

export enum IPCEventType {
    getPlatform = "getPlatform",
    appTerminate = "app.terminate",
    appRequestMainEvent = "app.event.requestMain",
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
    [IPCEventType.appRequestMainEvent]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            event: string;
            payload: any;
        },
        response: any;
    };
};
