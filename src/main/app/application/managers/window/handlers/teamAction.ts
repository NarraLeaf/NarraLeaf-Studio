/**
 * The whole of the Team protocol's IPC: five handlers for what is said, and one for bytes.
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
 *
 * **Every one of them but letting go asks first who the window is.** They all speak with the
 * account's sign-in, and that sign-in serves a (server, project) pair only once the author has said
 * so for that project. The pipe cannot tell one method from another and does not try; what it can
 * tell is the window, and `teamWindowReach.ts` is the whole of what each kind of window may reach -
 * the launcher as the account, Settings and the wizard a listing, a workspace only for a project
 * that uses the sign-in at that server, nothing else anything. A refusal carries a code the IPC
 * registry reports on, the way it reports a window naming a project that is not its own.
 * `team.unsubscribe` is the exception, because it only takes this window's own interest away.
 *
 * The sixth is {@link TeamTransferHandler}, and it is here because a file is the one thing
 * a call cannot carry - see the note on `IPCEventType.teamTransfer`. It is also the only
 * one of the six that reads a path, so it has a second thing to check: a path it is given
 * must be inside the asset content store of the project this window has open - narrower than
 * the boundary every other file the window touches is held to, because the path is worked out
 * from what another machine said.
 */
import path from "node:path";
import { unpatchedFsPromises as fs } from "../../../../../utils/unpatchedFs";

import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type { TeamCallOutcome, TeamConnection, TeamSubscribeOutcome } from "@shared/types/team";
import type { TeamTransferOutcome, TeamTransferRequest } from "@shared/types/teamTransfer";
import { WindowAppType } from "@shared/types/window";

import { requireTeamReach, TeamReachRefusedError } from "../../team/teamWindowReach";
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
        return this.tryUse(() => {
            requireTeamReach(window, remoteOrigin, { op: "open" });
            return window.app.getTeamManager().open(remoteOrigin);
        });
    }
}

/**
 * Where every server Studio knows about stands, for a list that draws all of them.
 *
 * The launcher's question: it is the picture of every server this machine is signed in to, and a
 * project's window is about one server rather than all of them.
 */
export class TeamConnectionsHandler extends IPCHandler<IPCEventType.teamConnections> {
    readonly name = IPCEventType.teamConnections;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
    ): Promise<RequestStatus<{ connections: TeamConnection[] }>> {
        return this.tryUse(() => {
            requireTeamReach(window, null, { op: "connections" });
            return { connections: window.app.getTeamManager().connections() };
        });
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
        return this.tryUse(async () => {
            const { letGo } = requireTeamReach(window, remoteOrigin, { op: "call", method });
            const team = window.app.getTeamManager();
            return letGo
                ? team.letGo(remoteOrigin, method, params)
                : team.call(remoteOrigin, method, params);
        });
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
        return this.tryUse(async () => {
            requireTeamReach(window, remoteOrigin, { op: "subscribe" });
            return window.app.getTeamManager().subscribe(window, remoteOrigin, topic);
        });
    }
}

/**
 * Stop being told.
 *
 * Best effort on purpose: a window that is closed without getting here is tidied up by
 * the manager, which watches for windows going. This is the tidy path, not the only one.
 *
 * **Not asked who the window is.** It takes away only this window's own interest - the manager
 * keys every holder by the window that asked - and it is sent at exactly the moment a project has
 * stopped using the sign-in, when the Team panel stops following the server. Refusing it then
 * would keep the topic subscribed for a window that is no longer told anything on it.
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

/**
 * Move a file between this project and a server.
 *
 * ⚠ **The path is checked here rather than trusted.** Every other file this window reaches
 * goes through a grant that holds it to the project it has open; this one does not, because
 * the reading and the writing happen in the main process. So a boundary is applied by hand,
 * and it is narrower than the project: a source or a destination outside the project's asset
 * content store is refused, and a window with no project - a launcher, a wizard - has no
 * store to be inside and is refused everything.
 *
 * ⚠ **The store, not the project.** The destination of a collect is worked out from a message
 * another Studio sent, so "inside the project" let a peer put a file anywhere in it - over a
 * script, a puppet runtime the editor imports, or the repository's own config. Team only ever
 * moves asset payloads, and those live under `assets/content` and nowhere else.
 *
 * And the server is held to the rule every other Team request is: bytes go to or come from a
 * server for a project that uses the sign-in held there. `status` names no server - it reads what
 * is moving on this machine - and is answered to a workspace whatever its project uses, because a
 * transfer it started outlives the answer that allowed it.
 */
export class TeamTransferHandler extends IPCHandler<IPCEventType.teamTransfer> {
    readonly name = IPCEventType.teamTransfer;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        request: IPCEvents[IPCEventType.teamTransfer]["data"],
    ): Promise<RequestStatus<TeamTransferOutcome>> {
        return this.tryUse(async () => {
            if (request.action === "status") {
                if (window.getWindowType() !== WindowAppType.Workspace) {
                    throw new TeamReachRefusedError({ kind: "none" }, { op: "transfer" });
                }
            } else {
                requireTeamReach(window, request.remoteOrigin, { op: "transfer" });
            }
            const named = fileNamedBy(request);
            if (named !== null && !(await withinAssetContent(window, named))) {
                return {
                    ok: false,
                    problem: {
                        kind: "unavailable",
                        detail: "that file is not an asset of the project this window has open",
                    },
                } satisfies TeamTransferOutcome;
            }
            return window.app.getTeamManager().transfer(request);
        });
    }
}

/** The file a request is about, or null for one that is about no file. */
export function fileNamedBy(request: TeamTransferRequest): string | null {
    if (request.action === "offer") {
        return request.source;
    }
    if (request.action === "collect") {
        return request.destination;
    }
    return null;
}

/**
 * Whether a path names a file below a project's asset content store (`assets/content`).
 *
 * ⚠ **Resolved on both sides before comparing, and compared at a separator.** `…/lantern-house`
 * must not read as inside `…/lantern`, and `…/content/../../scripts` must not read as inside the
 * store either - this is the only check standing between a window and a file the main process
 * would otherwise happily read or write on its behalf.
 *
 * ⚠ **And compared again through the links on disk.** A project is a folder somebody else may
 * have made, and a link inside it - the store itself, a shard directory, or the file - would take
 * the read or the write wherever it points while the path still spells the store. So the part of
 * each path that exists is resolved to where it really is before the second comparison; the part
 * that does not exist yet is created fresh by the transfer and cannot be a link.
 *
 * The store itself is not a file in it. Undefined for a window with no project: a launcher has no
 * store to be inside, so nothing is.
 */
export async function fileIsInAssetContent(projectPath: string | undefined, file: string): Promise<boolean> {
    if (projectPath === undefined || projectPath === "") {
        return false;
    }
    const store = path.resolve(projectPath, "assets", "content");
    if (!isStrictlyBelow(store, path.resolve(file))) {
        return false;
    }
    const [realStore, realFile] = await Promise.all([realpathOfExisting(store), realpathOfExisting(file)]);
    return isStrictlyBelow(realStore, realFile);
}

function isStrictlyBelow(directory: string, file: string): boolean {
    return file.startsWith(directory.endsWith(path.sep) ? directory : directory + path.sep);
}

/** A path with its longest existing prefix replaced by where that prefix really is. */
async function realpathOfExisting(target: string): Promise<string> {
    let existing = path.resolve(target);
    const rest: string[] = [];
    for (;;) {
        try {
            return path.join(await fs.realpath(existing), ...rest);
        } catch {
            const parent = path.dirname(existing);
            if (parent === existing) {
                return path.resolve(target);
            }
            rest.unshift(path.basename(existing));
            existing = parent;
        }
    }
}

async function withinAssetContent(window: AppWindow, file: string): Promise<boolean> {
    const props = window.getProps() as { projectPath?: string } | undefined;
    return fileIsInAssetContent(props?.projectPath, file);
}
