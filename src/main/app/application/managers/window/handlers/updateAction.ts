import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type { UpdateState } from "@shared/constants/update";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * The Settings panel's view of the updater.
 *
 * Deliberately thin: every one of these hands the call straight to `UpdateManager`, which is the
 * only thing that decides what a state transition means. The renderer never computes update
 * state of its own - what it draws is what the downloader reported, which is the whole point of
 * pushing state rather than letting a panel animate a plausible-looking bar.
 */
export class AppUpdateGetStateHandler extends IPCHandler<IPCEventType.appUpdateGetState> {
    readonly name = IPCEventType.appUpdateGetState;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow): RequestStatus<{ state: UpdateState }> {
        return this.success({ state: window.getApp().getUpdateManager().getState() });
    }
}

export class AppUpdateCheckHandler extends IPCHandler<IPCEventType.appUpdateCheck> {
    readonly name = IPCEventType.appUpdateCheck;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ state: UpdateState }>> {
        return this.success({ state: await window.getApp().getUpdateManager().check() });
    }
}

export class AppUpdateDownloadHandler extends IPCHandler<IPCEventType.appUpdateDownload> {
    readonly name = IPCEventType.appUpdateDownload;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ state: UpdateState }>> {
        return this.success({ state: await window.getApp().getUpdateManager().download() });
    }
}

/**
 * Quit and apply the downloaded installer.
 *
 * Answers before the quit begins rather than after - by then this window's renderer is gone and
 * there is nothing left to answer.
 */
export class AppUpdateInstallHandler extends IPCHandler<IPCEventType.appUpdateInstall> {
    readonly name = IPCEventType.appUpdateInstall;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow): RequestStatus<void> {
        const app = window.getApp();
        setImmediate(() => app.getUpdateManager().installNow());
        return this.success(void 0);
    }
}
