import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { FsRejectErrorCode } from "@shared/types/os";
import { probeMediaFile } from "../../media/mediaProbe";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Ask what is inside a media file and whether the engine can play it.
 *
 * The seam M2's import flow will call. It is read-only by construction: the handler runs ffprobe on
 * one path and returns a verdict. Nothing here converts, copies or writes, and no ffmpeg process is
 * ever started — only ffprobe.
 */
export class MediaProbeHandler extends IPCHandler<IPCEventType.mediaProbe> {
    readonly name = IPCEventType.mediaProbe;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { path }: IPCEvents[IPCEventType.mediaProbe]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.mediaProbe]["response"]>> {
        // The same gate every path-taking handler goes through. Handing an arbitrary renderer-named
        // path to a child process would be a way around the storage manager, and a wider one than
        // usual: ffprobe reads whatever it is pointed at, including files outside the project.
        if (!(await window.app.storageManager.isPathAllowed(window, path, "read"))) {
            return this.failed(
                new Error(`${FsRejectErrorCode.PERMISSION_DENIED}: file system access is not allowed for path: ${path}`),
            );
        }
        // `probeMediaFile` never throws: every failure is an arm of the outcome, because the caller
        // is a dialog that must say something about every file it was given.
        return this.success({ outcome: await probeMediaFile(window.getApp(), path) });
    }
}
