/**
 * The Move Mouse family's request, for a Dev Mode preview.
 *
 * The renderer cannot position the system cursor - no page can - so the act happens here, where the
 * platform call lives. What arrives is a point in the page and nothing more: the renderer has
 * already turned the author's stage coordinates into one, because only it knows how the surface is
 * laid out, and this side turns it into a point on the desktop, because only it knows where the
 * window is and what the display's scale factor is.
 *
 * The conversion and the platform call are the same code the packaged game runs
 * (`@shared/utils/blueprintPointerMove`). Dev Mode has to answer the way the shipped game does or
 * it is not a preview - and a cursor landing a few pixels off in one of the two is precisely the
 * kind of difference an author would not think to check.
 *
 * Comments in English per project convention.
 */

import { screen } from "electron";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type { BlueprintPointerMoveResult } from "@shared/types/blueprint/pointer";
import { executeBlueprintPointerMove } from "@shared/utils/blueprintPointerMove";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class BlueprintPointerMoveHandler extends IPCHandler<IPCEventType.blueprintPointerMove> {
    readonly name = IPCEventType.blueprintPointerMove;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintPointerMove]["data"],
    ): Promise<RequestStatus<{ result: BlueprintPointerMoveResult }>> {
        try {
            const result = await executeBlueprintPointerMove(data.request, window.getBrowserWindow(), { screen });
            // Always a success envelope: a host with no cursor support, or a refusal by the system,
            // is an outcome the node reads and branches on rather than an IPC failure.
            return this.success({ result });
        } catch (err) {
            return this.failed(err);
        }
    }
}
