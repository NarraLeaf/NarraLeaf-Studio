import { RendererInterfaceKey } from "./constants";
import { RequestStatus } from "./ipcEvents";
import { PlatformInfo } from "./os";

export interface RendererPreloadedInterface {
    getPlatform(): Promise<RequestStatus<PlatformInfo>>;
    terminate(err?: string): Promise<void>;
}

declare global {
    interface Window {
        [RendererInterfaceKey]: RendererPreloadedInterface;
    }
}
