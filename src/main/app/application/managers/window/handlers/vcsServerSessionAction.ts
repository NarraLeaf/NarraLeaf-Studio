import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type { VcsProjectServerSession } from "@shared/types/vcs";
import { requireWindowProject } from "../../../utils/windowProject";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Ask whether the calling window's project uses the sign-in held for its server.
 *
 * **What this handler does not do is answer.** It raises the question - in a window of Studio's
 * own, which the host opens and reads the answer from - and reports where the project stands once
 * the author has said. A workspace renders its project's content, and a question that content
 * could answer by calling an IPC is not a question; the only thing a caller chooses here is to
 * have it asked, and only about its own window's project.
 *
 * Separate from `vcsAction.ts` because it is the one handler on the surface whose purpose is the
 * sign-in question itself, rather than a request that may lead to it.
 *
 * The server may be named, for the one moment a project is asked about a server it is not connected
 * to: the server picker, where an author has chosen a destination and what that server holds cannot
 * be listed for this project until they have said it uses the sign-in there. Naming one lets a
 * caller choose which question is put, never what the answer is - and the question only goes up for
 * a server this installation holds a sign-in for.
 */
export class VcsUseServerSessionHandler extends IPCHandler<IPCEventType.vcsUseServerSession> {
    readonly name = IPCEventType.vcsUseServerSession;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, remoteOrigin }: IPCEvents[IPCEventType.vcsUseServerSession]["data"],
    ): Promise<RequestStatus<VcsProjectServerSession>> {
        return this.tryUse(() => window.app.getVcsManager().useServerSession(
            requireWindowProject(window, projectPath),
            typeof remoteOrigin === "string" && remoteOrigin.length > 0 ? remoteOrigin : undefined,
        ));
    }
}
