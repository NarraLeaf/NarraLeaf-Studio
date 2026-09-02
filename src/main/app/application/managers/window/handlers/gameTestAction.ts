import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { requireWindowProject } from "../../../utils/windowProject";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * The three calls a test run makes into main. Everything main says back arrives on
 * `IPCEventType.workspaceGameTestEvent` instead - pushed, not polled, because the ordering between
 * "the game logged this" and "the game then died" is the evidence a test reasons about.
 */
export class GameTestLaunchHandler extends IPCHandler<IPCEventType.gameTestLaunch> {
    readonly name = IPCEventType.gameTestLaunch;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        request: IPCEvents[IPCEventType.gameTestLaunch]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.gameTestLaunch]["response"]>> {
        // A refusal the author can read (frozen workspace, a session already running, a failed
        // compile) travels as a successful call carrying `{ok:false, reason}`, never as an IPC
        // error: the caller is a test that has to put the reason in its own report, and an IPC
        // failure loses everything but the message.
        return this.tryUse(() => window.getApp().getGameTestManager().launch({
            ...request,
            // The window's project, not the payload's - see `PreviewLaunchHandler`, which starts
            // the same process for the same reason.
            projectPath: requireWindowProject(window, request.projectPath),
        }));
    }
}

/**
 * Drive a running test session's game.
 *
 * Answers `{delivered}` rather than failing when the game is not listening: a session that has
 * already exited, or one whose game never opened its control channel, is a fact about the run the
 * caller has to weigh - not an IPC error, which would lose the distinction.
 */
export class GameTestSendCommandHandler extends IPCHandler<IPCEventType.gameTestSendCommand> {
    readonly name = IPCEventType.gameTestSendCommand;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, sessionId, command }: IPCEvents[IPCEventType.gameTestSendCommand]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.gameTestSendCommand]["response"]>> {
        return this.tryUse(() => ({
            delivered: window.getApp().getGameTestManager().sendCommand(projectPath, sessionId, command),
        }));
    }
}

export class GameTestStopHandler extends IPCHandler<IPCEventType.gameTestStop> {
    readonly name = IPCEventType.gameTestStop;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, sessionId }: IPCEvents[IPCEventType.gameTestStop]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.gameTestStop]["response"]>> {
        return this.tryUse(async () => {
            await window.getApp().getGameTestManager().stop(projectPath, sessionId);
            return {};
        });
    }
}
