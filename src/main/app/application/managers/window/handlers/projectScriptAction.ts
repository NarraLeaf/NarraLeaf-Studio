/**
 * Opening the project's scripts folder in whatever the author edits with.
 *
 * Studio has no script editor on purpose. `<project>/scripts/` is the one directory whose bytes the
 * disk owns rather than Studio, because a document service that kept a copy of a script would write
 * that copy back over an edit made in another editor. A second editor inside Studio would be a
 * second writer over exactly those bytes, so the honest affordance is to hand the folder to the
 * author's own tools. The read-only preview in the workspace is a reader, never a writer.
 *
 * **The folder, not the file.** A script type-checks against `scripts/tsconfig.json` and the
 * generated declarations in `scripts/.narraleaf/`, and an editor resolves both from the folder it
 * has open; opened on a single file it resolves neither. The file travels alongside so the editor
 * lands on it. See `externalScriptEditors.ts` for why this is not `shell.openPath`.
 *
 * Two guards, and it takes both. The project has to be the window's own, which stops this reaching
 * another project on disk; and the path has to be one `isScriptSourcePath` accepts, which stops it
 * reaching anything but a `.ts` or `.js` file under `scripts/`, dependencies and generated
 * declarations excluded. What a renderer can name here is therefore a file the author is already
 * looking at in Studio - and a target by id, never a command line.
 */

import path from "path";
import { shell } from "electron";
import { SCRIPTS_DIR, isScriptSourcePath } from "@shared/project/scriptsDirectory";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import type { ExternalScriptEditor } from "@shared/types/scriptEditors";
import { refuseDistrustedWindow } from "../../../utils/projectTrustGate";
import { requireWindowProject } from "../../../utils/windowProject";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import {
    detectExternalScriptEditors,
    isKnownExternalScriptEditor,
    openFolderInExternalEditor,
} from "./externalScriptEditors";

export class ProjectOpenScriptHandler extends IPCHandler<IPCEventType.projectOpenScript> {
    readonly name = IPCEventType.projectOpenScript;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, scriptRef, target }: IPCEvents[IPCEventType.projectOpenScript]["data"],
    ): Promise<RequestStatus<void>> {
        return this.tryUse(async () => {
            const root = requireWindowProject(window, projectPath);
            const directory = path.resolve(root, SCRIPTS_DIR);
            let file: string | undefined;

            if (scriptRef !== undefined) {
                if (typeof scriptRef !== "string" || !isScriptSourcePath(scriptRef)) {
                    throw new Error(`Refusing to open a path that is not one of this project's scripts: ${String(scriptRef)}`);
                }
                // `isScriptSourcePath` already refuses `..` - it splits the path and requires the
                // first segment to be `scripts` - but the join is resolved and checked against the
                // root anyway, because that predicate's job is classification and this one's is
                // containment.
                const absolute = path.resolve(root, ...scriptRef.split("/"));
                if (path.relative(root, absolute).startsWith("..")) {
                    throw new Error(`Refusing to open a path outside the project: ${scriptRef}`);
                }
                file = absolute;
            }

            // The file manager, which needs nothing installed. `showItemInFolder` when there is a
            // file to point at, so the author lands on the row rather than on the folder.
            if (target === undefined || target === "reveal") {
                if (file) {
                    shell.showItemInFolder(file);
                    return;
                }
                await openWithSystem(directory);
                return;
            }

            // The OS association, handed the folder rather than the file: `.ts` is registered to a
            // media player on many Windows machines, and a folder is unambiguous everywhere.
            if (target === "system") {
                await openWithSystem(directory);
                return;
            }

            if (!isKnownExternalScriptEditor(target)) {
                throw new Error(`Unknown editor: ${target}`);
            }
            // Only the editors are gated. Starting a program on the project's behalf is what a
            // distrusted project does not get; the two targets above start nothing of ours, and
            // reading somebody else's files is what an author does before trusting them.
            const distrusted = refuseDistrustedWindow(window, "script editor");
            if (distrusted) {
                throw new Error(distrusted);
            }
            await openFolderInExternalEditor({ editorId: target, directory, file });
        });
    }
}

/** `openPath` answers with a message rather than throwing, and an empty string means it worked. */
async function openWithSystem(target: string): Promise<void> {
    const failure = await shell.openPath(target);
    if (failure) {
        throw new Error(failure);
    }
}

export class ProjectListScriptEditorsHandler extends IPCHandler<IPCEventType.projectListScriptEditors> {
    readonly name = IPCEventType.projectListScriptEditors;
    readonly type = IPCMessageType.request;

    public async handle(): Promise<RequestStatus<ExternalScriptEditor[]>> {
        // No project and no paths: this reads PATH and nothing else, so it cannot be used to probe
        // the file system for anything the author did not install.
        return this.tryUse(async () => detectExternalScriptEditors());
    }
}
