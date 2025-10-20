import { AppInfo } from "./app";
import { RendererInterfaceKey } from "./constants";
import { RequestStatus } from "./ipcEvents";
import { PlatformInfo } from "./os";
import { WindowAppType, WindowProps, WindowVisibilityStatus } from "./window";

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
        },
    }
}

declare global {
    interface Window {
        [RendererInterfaceKey]: RendererPreloadedInterface;
    }
}
