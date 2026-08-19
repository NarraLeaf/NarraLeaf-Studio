import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * What Studio is working on, for whoever has to explain a pause.
 *
 * One handler and one shape for every kind of long work, which is the point of the concept: a
 * surface that wanted to report a build, a conversion and a bake used to need three subscriptions
 * and three vocabularies.
 */
export class StudioTasksGetOverviewHandler extends IPCHandler<IPCEventType.studioTasksGetOverview> {
    readonly name = IPCEventType.studioTasksGetOverview;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
    ): RequestStatus<IPCEvents[IPCEventType.studioTasksGetOverview]["response"]> {
        return this.success({ overview: window.getApp().getTaskScheduler().getOverview() });
    }
}
