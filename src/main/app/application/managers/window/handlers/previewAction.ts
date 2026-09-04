import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { requireWindowProject } from "../../../utils/windowProject";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class PreviewLaunchHandler extends IPCHandler<IPCEventType.previewLaunch> {
    readonly name = IPCEventType.previewLaunch;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, entry }: IPCEvents[IPCEventType.previewLaunch]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.previewLaunch]["response"]>> {
        return this.tryUse(async () => {
            // The window's project, not the payload's. A preview runs the project's code, so which
            // project that is has to be the one this window was opened on - the rule a build and a
            // Dev Mode launch already follow, and the one the trust gate behind this assumes.
            const status = await window.getApp().getPreviewManager()
                .launch(requireWindowProject(window, projectPath), entry);
            return { status };
        });
    }
}

export class PreviewStopHandler extends IPCHandler<IPCEventType.previewStop> {
    readonly name = IPCEventType.previewStop;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.previewStop]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.previewStop]["response"]>> {
        return this.tryUse(async () => {
            // The window's project, not the payload's. Lower harm than a launch - it ends a
            // session rather than starting one - but it is the same question, and a preview that
            // stops for a reason its own window can neither see nor explain is worse than the
            // inconsistency of guarding only the launch.
            const status = await window.getApp().getPreviewManager()
                .stop(requireWindowProject(window, projectPath));
            return { status };
        });
    }
}

export class PreviewGetStatusHandler extends IPCHandler<IPCEventType.previewGetStatus> {
    readonly name = IPCEventType.previewGetStatus;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.previewGetStatus]["data"],
    ): RequestStatus<IPCEvents[IPCEventType.previewGetStatus]["response"]> {
        // The window's project, not the payload's. What it discloses is small - whether some
        // project is being previewed - but it is polled, so leaving it open would be a way to
        // watch another author's session start and end.
        try {
            const status = window.getApp().getPreviewManager()
                .getStatus(requireWindowProject(window, projectPath));
            return this.success({ status });
        } catch (error) {
            return this.failed(error);
        }
    }
}

export class PreviewResetDataHandler extends IPCHandler<IPCEventType.previewResetData> {
    readonly name = IPCEventType.previewResetData;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.previewResetData]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.previewResetData]["response"]>> {
        return this.tryUse(async () => {
            // The window's project, not the payload's. This is a recursive delete of a directory
            // derived from the path it is given - `<project>/.nlstudio/preview/userData` - so a
            // payload naming another project throws away that project's preview saves, which is
            // the one thing in the preview profile that is not a cache the next launch rebuilds.
            await window.getApp().getPreviewManager()
                .resetPlayerData(requireWindowProject(window, projectPath));
        });
    }
}
