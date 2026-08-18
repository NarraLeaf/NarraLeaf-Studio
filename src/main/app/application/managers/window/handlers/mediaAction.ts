import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { FsRejectErrorCode } from "@shared/types/os";
import { probeMediaFile } from "../../media/mediaProbe";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * The media seam: ask what is inside a file, then convert it if the answer says so.
 *
 * Two capabilities with very different reach, which is why they are separate handlers with separate
 * permission checks rather than one call that does whichever the verdict implies. The probe reads;
 * the conversion writes, and the caller has to be entitled to the destination as well as the source.
 */

/**
 * Ask what is inside a media file and whether the engine can play it.
 *
 * Read-only by construction: the handler runs ffprobe on one path and returns a verdict. Nothing on
 * this path converts, copies or writes.
 */
export class MediaProbeHandler extends IPCHandler<IPCEventType.mediaProbe> {
  readonly name = IPCEventType.mediaProbe;
  readonly type = IPCMessageType.request;

  public async handle(
    window: AppWindow,
    { path }: IPCEvents[IPCEventType.mediaProbe]["data"]
  ): Promise<RequestStatus<IPCEvents[IPCEventType.mediaProbe]["response"]>> {
    // The same gate every path-taking handler goes through. Handing an arbitrary renderer-named
    // path to a child process would be a way around the storage manager, and a wider one than
    // usual: ffprobe reads whatever it is pointed at, including files outside the project.
    if (!(await window.app.storageManager.isPathAllowed(window, path, "read"))) {
      return this.failed(
        new Error(
          `${FsRejectErrorCode.PERMISSION_DENIED}: file system access is not allowed for path: ${path}`
        )
      );
    }
    // `probeMediaFile` never throws: every failure is an arm of the outcome, because the caller
    // is a dialog that must say something about every file it was given.
    return this.success({ outcome: await probeMediaFile(window.getApp(), path) });
  }
}

/**
 * Begin converting a file, and answer with the job id to poll.
 *
 * Two grants, not one. Reading the source and creating the target are separate permissions and the
 * storage manager is asked about both: a renderer that could name any writable path here would have
 * an ffmpeg-shaped way to create a file anywhere on the machine, which is a wider hole than the
 * probe's (that one could only *read* what it was pointed at).
 *
 * The scratch file the conversion writes first is a sibling of the target, and is covered by the
 * same grant: the storage manager's grants are directory-recursive, so a caller permitted to create
 * the target is permitted to create a temporary name beside it.
 */
export class MediaConvertStartHandler extends IPCHandler<IPCEventType.mediaConvertStart> {
  readonly name = IPCEventType.mediaConvertStart;
  readonly type = IPCMessageType.request;

  public async handle(
    window: AppWindow,
    { request }: IPCEvents[IPCEventType.mediaConvertStart]["data"]
  ): Promise<RequestStatus<IPCEvents[IPCEventType.mediaConvertStart]["response"]>> {
    const { storageManager } = window.app;
    if (!(await storageManager.isPathAllowed(window, request.sourcePath, "read"))) {
      return this.failed(
        new Error(
          `${FsRejectErrorCode.PERMISSION_DENIED}: file system access is not allowed for path: ${request.sourcePath}`
        )
      );
    }
    if (!(await storageManager.isPathAllowed(window, request.targetPath, "write"))) {
      return this.failed(
        new Error(
          `${FsRejectErrorCode.PERMISSION_DENIED}: file system access is not allowed for path: ${request.targetPath}`
        )
      );
    }
    return this.success({ state: await window.getApp().getMediaConvertManager().start(request) });
  }
}

/**
 * Stop a conversion.
 *
 * No path check: a job id is the only argument, it is a random UUID handed out by `start`, and
 * cancelling deletes only the scratch file the job itself created. An unknown id answers `idle`
 * rather than failing, so a renderer polling a job that has aged out is not an error case.
 */
export class MediaConvertCancelHandler extends IPCHandler<IPCEventType.mediaConvertCancel> {
  readonly name = IPCEventType.mediaConvertCancel;
  readonly type = IPCMessageType.request;

  public handle(
    window: AppWindow,
    { jobId }: IPCEvents[IPCEventType.mediaConvertCancel]["data"]
  ): RequestStatus<IPCEvents[IPCEventType.mediaConvertCancel]["response"]> {
    return this.success({ state: window.getApp().getMediaConvertManager().cancel(jobId) });
  }
}

export class MediaConvertGetStatusHandler extends IPCHandler<IPCEventType.mediaConvertGetStatus> {
  readonly name = IPCEventType.mediaConvertGetStatus;
  readonly type = IPCMessageType.request;

  public handle(
    window: AppWindow,
    { jobId }: IPCEvents[IPCEventType.mediaConvertGetStatus]["data"]
  ): RequestStatus<IPCEvents[IPCEventType.mediaConvertGetStatus]["response"]> {
    return this.success({ state: window.getApp().getMediaConvertManager().getStatus(jobId) });
  }
}
