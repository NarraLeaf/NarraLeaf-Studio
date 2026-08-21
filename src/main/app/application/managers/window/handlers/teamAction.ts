/**
 * The whole of the Team protocol's IPC, and it is five handlers.
 *
 * Not five per feature - five altogether, however many features the protocol grows. A
 * call names a method the server declared it serves and carries whatever that method
 * takes; a subscription names a topic. Neither this file nor the enum beside it has
 * anything to say about comments, and it will have nothing to say about whatever comes
 * after them either.
 *
 * That is the point of the migration these arrived in. The version-control side of a
 * server needed a handler per question - projects, one project, its history, the members,
 * deleting one - and each of those cost an enum entry, a shape, a handler, a preload
 * line and a renderer type. Five questions were about the most that arrangement could
 * carry; conversations alone are six.
 *
 * The window is passed through to the manager because **a subscription belongs to a
 * window**, not to Studio: two windows may be looking at different projects on the same
 * server, and the last one to stop looking is what ends a subscription.
 */
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type { TeamCallOutcome, TeamConnection, TeamSubscribeOutcome } from "@shared/types/team";

import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Open a session with one server, and say where it stands.
 *
 * Answers immediately with whatever that is - usually `connecting` - rather than waiting
 * for the session to be ready. A screen draws the state it is given and is told again
 * when it changes; one that waited would be a screen that hangs on a server that is off.
 */
export class TeamOpenHandler extends IPCHandler<IPCEventType.teamOpen> {
    readonly name = IPCEventType.teamOpen;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { remoteOrigin }: IPCEvents[IPCEventType.teamOpen]["data"],
    ): Promise<RequestStatus<TeamConnection>> {
        return this.tryUse(() => window.app.getTeamManager().open(remoteOrigin));
    }
}

/** Where every server Studio knows about stands, for a list that draws all of them. */
export class TeamConnectionsHandler extends IPCHandler<IPCEventType.teamConnections> {
    readonly name = IPCEventType.teamConnections;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
    ): Promise<RequestStatus<{ connections: TeamConnection[] }>> {
        return this.tryUse(() => ({ connections: window.app.getTeamManager().connections() }));
    }
}

/**
 * Ask a server something.
 *
 * The method and its parameters are carried through unread. What checks them is the
 * server, and what types them is `@shared/types/team` at both ends - this is a pipe, and
 * a pipe that understood its contents would be a pipe that had to be edited every time
 * the protocol grew a verb.
 */
export class TeamCallHandler extends IPCHandler<IPCEventType.teamCall> {
    readonly name = IPCEventType.teamCall;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { remoteOrigin, method, params }: IPCEvents[IPCEventType.teamCall]["data"],
    ): Promise<RequestStatus<TeamCallOutcome>> {
        return this.tryUse(async () =>
            window.app.getTeamManager().call(remoteOrigin, method, params));
    }
}

/** Ask to be told about a topic, on behalf of this window. */
export class TeamSubscribeHandler extends IPCHandler<IPCEventType.teamSubscribe> {
    readonly name = IPCEventType.teamSubscribe;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { remoteOrigin, topic }: IPCEvents[IPCEventType.teamSubscribe]["data"],
    ): Promise<RequestStatus<TeamSubscribeOutcome>> {
        return this.tryUse(async () =>
            window.app.getTeamManager().subscribe(window, remoteOrigin, topic));
    }
}

/**
 * Stop being told.
 *
 * Best effort on purpose: a window that is closed without getting here is tidied up by
 * the manager, which watches for windows going. This is the tidy path, not the only one.
 */
export class TeamUnsubscribeHandler extends IPCHandler<IPCEventType.teamUnsubscribe> {
    readonly name = IPCEventType.teamUnsubscribe;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { remoteOrigin, topic }: IPCEvents[IPCEventType.teamUnsubscribe]["data"],
    ): Promise<RequestStatus<void>> {
        return this.tryUse(async () =>
            window.app.getTeamManager().unsubscribe(window, remoteOrigin, topic));
    }
}
