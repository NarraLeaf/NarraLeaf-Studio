import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { WindowAppType, WindowCloseResults } from "@shared/types/window";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Put one question to the author in a window of its own, and answer with what came of it.
 *
 * The same shape as the plugin permission prompt: a modal child of the window that asked,
 * a promise held open until it closes, and a resolver reading the close result. What the
 * window does with a yes is the certificate install itself, through the same
 * `vcs.trustAuthority` channel any other surface uses - there is one path onto this
 * machine's trust store and this window does not add a second.
 *
 * A window closed without an answer arrives here as `null` and is read as a refusal,
 * which is the only reading that keeps the caller from waiting forever.
 */
export class ServerTrustPromptHandler extends IPCHandler<IPCEventType.serverTrustPrompt> {
    readonly name = IPCEventType.serverTrustPrompt;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { props }: IPCEvents[IPCEventType.serverTrustPrompt]["data"],
    ): Promise<RequestStatus<{ trusted: boolean }>> {
        const promptWindow = await window.getApp().launchServerTrustPrompt(window, props);
        window.addChild(promptWindow);

        return new Promise<RequestStatus<{ trusted: boolean }>>(resolve => {
            promptWindow.setCloseResultResolver((result: WindowCloseResults[WindowAppType.ServerTrustPrompt]) => {
                resolve(this.success({ trusted: result?.trusted === true }));
            });
        });
    }
}
