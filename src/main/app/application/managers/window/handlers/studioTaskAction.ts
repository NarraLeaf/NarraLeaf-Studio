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

/**
 * Have the weather a project's stories name ready before anyone asks for it.
 *
 * Answers as soon as the work is submitted rather than when it finishes: nobody is waiting on this,
 * and a caller that awaited it would turn speculation into a stall. What makes it free is the two
 * priorities - a bake started here at `idle` yields to a run, and if the author presses Run while it
 * is half done the same submission arrives at `blocking` and adopts the work in flight rather than
 * restarting it.
 *
 * Never reports a failure. A clip that could not be produced is produced again, blockingly, the
 * moment something actually needs it, and that is where an author gets told.
 */
export class StudioTasksPrebakeWeatherHandler extends IPCHandler<IPCEventType.studioTasksPrebakeWeather> {
    readonly name = IPCEventType.studioTasksPrebakeWeather;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        { projectPath, specs }: IPCEvents[IPCEventType.studioTasksPrebakeWeather]["data"],
    ): RequestStatus<IPCEvents[IPCEventType.studioTasksPrebakeWeather]["response"]> {
        if (projectPath && specs.length > 0) {
            void window.getApp().getWeatherBakeManager()
                .ensure({ projectRoot: projectPath, specs, priority: "idle" });
        }
        return this.success({});
    }
}
