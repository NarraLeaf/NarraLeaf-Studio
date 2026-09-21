import path from "path";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { WINDOW_PROJECT_MISMATCH_CODE } from "@shared/types/window";
import type { AppWindow } from "../managers/window/appWindow";

/**
 * The project a window has open, or `null` for a window that has none.
 *
 * Read off the window props rather than looked up anywhere else, because the props are what the
 * main process itself wrote when it opened the project: `windowPermissionDeclarations` derives this
 * window's recursive file-system grant from the very same field, so a project named here is the
 * project this window was authorised for and nothing else.
 *
 * Workspace and Dev Mode windows have one. The launcher, settings, the wizard and the two prompt
 * windows do not, and answer `null` - they are not editing a project, and a request from one of them
 * that names a project is not a request whose project can be checked.
 */
export function windowProjectPath(window: AppWindow): string | null {
    const props = window.getProps() as { projectPath?: unknown } | undefined;
    return typeof props?.projectPath === "string" && props.projectPath.length > 0
        ? props.projectPath
        : null;
}

/**
 * A request that named a project other than its window's own.
 *
 * The `code` travels with it through `IPCHandler.failed`, which reads `error.code` off whatever was
 * thrown; the sentence is for the log.
 */
export class WindowProjectMismatchError extends Error {
    readonly code = WINDOW_PROJECT_MISMATCH_CODE;

    constructor(named: string) {
        super(`This window has no such project open: ${named}`);
    }
}

/**
 * The project this request is about, taken from the window rather than believed from the payload.
 *
 * # What this is for
 *
 * Most `projectPath` fields crossing IPC are not a choice the renderer is making. They say "the
 * project I have open", which the main process already knows and wrote into the window's props -
 * the renderer only has the string because it read it back out of them. Nothing checked that until
 * now, so a renderer able to send a message was a renderer able to name *somebody else's* project
 * and have the main process act on it, with the whole of that project's tree reachable through
 * whatever the handler goes on to do. Compiling one is the sharpest case: a build reads the target
 * tree, runs its plugins' build steps, and writes a distributable out of it.
 *
 * So the assertion is the narrow one: the payload has to agree with the window. It is not a
 * substitute for asking whether the operation is allowed at all - a project can be the window's own
 * and still be one Studio will not run - and it deliberately does not look at any ledger. It answers
 * one question, "is this request about this window's project", and it is the question nothing was
 * asking.
 *
 * # Why it is not applied to every payload that carries one
 *
 * A handful of `projectPath` fields genuinely name a project other than the caller's: opening a
 * recent project, asking whether some project is already open, scaffolding a new one. Those are the
 * requests where naming another project *is* the request, and a blanket rule over every payload
 * would break them. Which events belong to which group is a roster, and a roster is a decision about
 * the whole surface rather than about any one handler; this is the check those decisions would be
 * spelled with, not the decision itself.
 *
 * # Why it answers with the window's own spelling
 *
 * The path handed back is the window's, not the caller's, so that everything downstream keys off a
 * string the main process owns. `D:\Game` and `d:\game` are one project and two session keys, and a
 * handler that let the caller pick which spelling to use could start a build under one and poll for
 * its status under the other. Comparison folds those spellings through `normalizeProjectPath`, the
 * one identity rule the whole app shares - `path.normalize` alone leaves the case apart on Windows,
 * and a check that misses on the other spelling refuses the author's own project, which is a worse
 * failure than the hole it closes. Both sides are resolved first because that is what the managers
 * behind these handlers do with the path before using it, so this judges the string they will see.
 *
 * @throws WindowProjectMismatchError when the window has no project, or a different one.
 */
export function requireWindowProject(window: AppWindow, named: string): string {
    // The type says string; the sender is a renderer, so the value is whatever crossed. Checked
    // here rather than left to `path.resolve` to throw, because that throw would carry Node's
    // `ERR_INVALID_ARG_TYPE` to the renderer in place of this guard's own code, and a refusal that
    // reports itself as an argument bug is a refusal nobody will recognise later.
    if (typeof named !== "string" || named.length === 0) {
        throw new WindowProjectMismatchError(String(named));
    }
    const own = windowProjectPath(window);
    if (!own) {
        throw new WindowProjectMismatchError(named);
    }
    if (normalizeProjectPath(path.resolve(named)) !== normalizeProjectPath(path.resolve(own))) {
        throw new WindowProjectMismatchError(named);
    }
    return own;
}

/**
 * The directory a request may make a project's repository in - {@link requireWindowProject} for a
 * window that has a project, and "somewhere this window was granted to write" for one that has none.
 *
 * # Why the one assertion does not fit here
 *
 * `vcs.initRepository` is asked by two windows. The workspace asks it about its own project, from
 * the version rail's Enable button. The project wizard asks it about the directory it has just
 * written a new project into, and the wizard has no project of its own - so asserting the window's
 * project would refuse the one call that makes "create with version control" work, and nothing tsc
 * or the workspace can see would say so.
 *
 * # So the question splits on whether the window has a project
 *
 * A window that has one is asked the ordinary question. Its only reason to name a directory is its
 * own project, and the looser rule would let it plant a repository in any folder of its tree, or in
 * one the author once picked to export to.
 *
 * A window that has none must name a directory it holds a WRITE grant over. The wizard writes the
 * whole project through that grant before it asks, so the directory it names is one it has just
 * filled; a directory it was never granted is one it did not create, and is somebody else's. The
 * same rule already stands in front of `projectWizard.created`, the wizard's other report about the
 * project it made.
 *
 * Refused with the mismatch error, and so with its code, because from the author's side it is the
 * same event - a request naming a place this window has no business with - and the IPC registry
 * reports it through the one throttled line that never repeats the path.
 *
 * The payload's spelling is what comes back for a window with no project: there is no other one to
 * prefer, and the manager folds spellings into one repository root itself.
 *
 * @throws WindowProjectMismatchError when the window has a different project, or has none and was
 *   not granted to write the named directory.
 */
export async function requireWindowProjectOrWriteGrant(window: AppWindow, named: string): Promise<string> {
    if (windowProjectPath(window)) {
        return requireWindowProject(window, named);
    }
    if (typeof named !== "string" || named.length === 0) {
        throw new WindowProjectMismatchError(String(named));
    }
    if (!await window.app.storageManager.isPathAllowed(window, path.resolve(named), "write")) {
        throw new WindowProjectMismatchError(named);
    }
    return named;
}
