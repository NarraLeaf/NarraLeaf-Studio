import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Raise first-run setup's preview at full size.
 *
 * Nothing crosses this channel in either direction. The window draws the same sample the setup
 * screen does, from the same preferences, and it is raised to be looked at rather than asked a
 * question - so unlike the two prompt windows beside it, this handler does not hold a promise open
 * waiting for a close result.
 */
export class OnboardingPreviewHandler extends IPCHandler<IPCEventType.onboardingPreviewOpen> {
    readonly name = IPCEventType.onboardingPreviewOpen;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<void>> {
        await window.getApp().launchOnboardingPreview(window);
        return this.success(undefined);
    }
}
