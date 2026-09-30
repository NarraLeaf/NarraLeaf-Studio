import crypto from "crypto";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { requireWindowProject } from "../../../utils/windowProject";
import { WeatherBakeOwner } from "../../weather/WeatherBakeManager";
import { devModeScreenEffectQuality, screenEffectBakeThreads } from "../../weather/screenEffectQuality";
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
 *
 * ## One message is one ask
 *
 * The specs are what this project's stories say NOW, so they are claimed as the whole of what the
 * pre-baker wants: a clip it asked for last time and does not ask for here describes a document that
 * no longer exists, and is dropped rather than left encoding. Without that, an author dragging a
 * density through five values leaves four bakes running for numbers they never saw, and the fifth -
 * the one they are watching for - waits behind all of them.
 *
 * That is also why an empty list still gets through: removing the last weather row is exactly the
 * ask "nothing, now", and the bake for the row that is gone has to hear it.
 */
export class StudioTasksPrebakeWeatherHandler extends IPCHandler<IPCEventType.studioTasksPrebakeWeather> {
    readonly name = IPCEventType.studioTasksPrebakeWeather;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        { projectPath, specs }: IPCEvents[IPCEventType.studioTasksPrebakeWeather]["data"],
    ): RequestStatus<IPCEvents[IPCEventType.studioTasksPrebakeWeather]["response"]> {
        if (projectPath) {
            // Baking reads the project's stories and spawns ffmpeg over its clips, so the project
            // has to be the window's own: a renderer free to name one would be free to have some
            // other project read and encoded on its behalf.
            const projectRoot = requireWindowProject(window, projectPath);
            void window.getApp().getWeatherBakeManager().ensure({
                projectRoot,
                specs,
                priority: "idle",
                // Whatever Dev Mode will ask for, because being ready for it is the only reason this
                // exists. See `devModeScreenEffectQuality`.
                quality: devModeScreenEffectQuality(window.getApp()),
                threads: screenEffectBakeThreads(window.getApp()),
                claim: { owner: WeatherBakeOwner.prebake(projectRoot), attempt: crypto.randomUUID() },
            });
        }
        return this.success({});
    }
}
