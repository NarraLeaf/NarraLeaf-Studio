/**
 * Opening one of the project's own script files in whatever the author edits with.
 *
 * Studio has no script editor on purpose. `<project>/scripts/` is the one directory whose bytes the
 * disk owns rather than Studio, because a document service that kept a copy of a script would write
 * that copy back over an edit made in another editor. A second editor inside Studio would be a
 * second writer over exactly those bytes, so the honest affordance is to hand the file to the
 * author's own tools.
 *
 * Two guards, and it takes both. The project has to be the window's own, which stops this reaching
 * another project on disk; and the path has to be one `isScriptSourcePath` accepts, which stops it
 * reaching anything but a `.ts` or `.js` file under `scripts/`, dependencies and generated
 * declarations excluded. What a renderer can name here is therefore a file the author is already
 * looking at in Studio.
 */

import path from "path";
import { shell } from "electron";
import { isScriptSourcePath } from "@shared/project/scriptsDirectory";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { requireWindowProject } from "../../../utils/windowProject";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class ProjectOpenScriptHandler extends IPCHandler<IPCEventType.projectOpenScript> {
    readonly name = IPCEventType.projectOpenScript;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, scriptRef }: IPCEvents[IPCEventType.projectOpenScript]["data"],
    ): Promise<RequestStatus<void>> {
        return this.tryUse(async () => {
            const root = requireWindowProject(window, projectPath);
            if (typeof scriptRef !== "string" || !isScriptSourcePath(scriptRef)) {
                throw new Error(`Refusing to open a path that is not one of this project's scripts: ${String(scriptRef)}`);
            }
            // `isScriptSourcePath` already refuses `..` - it splits the path and requires the first
            // segment to be `scripts` - but the join is resolved and checked against the root
            // anyway, because that predicate's job is classification and this one's is containment.
            const absolute = path.resolve(root, ...scriptRef.split("/"));
            if (path.relative(root, absolute).startsWith("..")) {
                throw new Error(`Refusing to open a path outside the project: ${scriptRef}`);
            }
            // openPath answers with a message rather than throwing, and an empty string means it
            // worked. A file type the machine has no editor for opens the system's chooser, which
            // is the right outcome: it is the author's file and their choice of tool.
            const failure = await shell.openPath(absolute);
            if (failure) {
                throw new Error(failure);
            }
        });
    }
}
