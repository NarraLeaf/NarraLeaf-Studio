import type { App } from "@/app/app";
import type { AppWindow } from "../managers/window/appWindow";
import type { ProjectTrustManager } from "../managers/projectTrustManager";
import { windowProjectPath } from "./windowProject";
import { emitWorkspaceConsoleLog } from "./workspaceConsole";

/**
 * The refusals a distrusted project meets in the main process.
 *
 * # Why this is not part of the freeze gate next door
 *
 * They answer different questions. Freeze asks "may Studio write to this project"; this asks "may
 * this project make Studio do something". A frozen project is one the author is reading history in;
 * a distrusted one is somebody else's, and stays fully editable. Folding distrust into
 * `WorkspaceFreezeKind` would have taken editing away with it.
 *
 * The two also differ in a way that matters more than the wording. Freeze is **reported to main by
 * the renderer**, and its absence means allowed - it is a consistency guard, and failing open costs
 * a confusing build. This gate is held by main alone and its absence means refused, because the
 * thing it guards is running somebody else's code.
 *
 * # Why every one of these is in main
 *
 * Each operation below is started by main. The controls in the interface that grey themselves out
 * are affordance: a keybinding, a plugin, a stale renderer or a second window can all still ask,
 * and there is exactly one place that can answer no.
 */

/**
 * The operations a distrusted project does not get, named as the author would name them.
 *
 * A list rather than a bare union so a test can walk it. Every entry here is something that either
 * runs code the project supplied, starts a child process on its behalf, or sends a request to an
 * address the project chose; adding one means a gate exists somewhere for it, and the test beside
 * this file will not let a new name in without one.
 */
export const DISTRUSTED_OPERATIONS = [
    "production build",
    "patch export",
    "preview",
    "Dev Mode",
    "test run",
    "weather clip bake",
    "media inspection",
    "media conversion",
    "remote asset download",
    "network request",
    "external link",
] as const;

export type DistrustedOperation = typeof DISTRUSTED_OPERATIONS[number];

export function projectDistrustedMessage(operation: DistrustedOperation): string {
    return `The ${operation} is unavailable because this project is not trusted. `
        + "Studio does not run a project it did not create until you trust it under Settings.";
}

/**
 * Refuse the operation when the project is not trusted, and say so where the author will see it.
 *
 * Returns the message when refused and `null` when allowed, so a caller can reject, resolve to a
 * failed status, or return early in whatever shape it already uses - the managers below do all
 * three, and forcing one on them would mean rewriting their result types to add a gate.
 *
 * The console line is not optional. Several of these operations are started by something other than
 * a click - a watcher relaunching a preview, the weather bake settling after a project opens - and a
 * refusal nobody can see reads as Studio quietly not working.
 */
export function projectDistrustedRefusal(
    host: { projectTrustManager: ProjectTrustManager },
    projectPath: string,
    operation: DistrustedOperation,
): string | null {
    return host.projectTrustManager.isTrusted(projectPath) ? null : projectDistrustedMessage(operation);
}

/**
 * {@link projectDistrustedRefusal}, and say it where the author will see it.
 *
 * Two functions rather than a flag, because the callers do not all hold the same thing: managers
 * reached from the interface have the whole `App`, while ones built against a narrow structural
 * host - the weather baker takes only what it needs to find ffmpeg - have the ledger and nothing to
 * log through. Widening those hosts to satisfy a gate would be the tail wagging the dog.
 */
export function refuseDistrustedOperation(
    app: App,
    projectPath: string,
    operation: DistrustedOperation,
): string | null {
    const message = projectDistrustedRefusal(app, projectPath, operation);
    if (message) {
        emitWorkspaceConsoleLog(app, projectPath, { level: "error", source: "Trust", message });
    }
    return message;
}

/**
 * Refuse an operation asked for by a window whose project is not trusted.
 *
 * Takes the project from the **window**, never from the request. Fifty-odd IPC payloads carry a
 * `projectPath` of their own and nothing checks it against the window that sent it; a gate that
 * read one of those would be asking the caller whether the caller is allowed.
 *
 * A window with no project - the launcher, settings - is not governed by project trust at all, and
 * answers null. Workspace and Dev Mode windows both have one. A Dev Mode window only ever opens on
 * a project that was trusted when it launched, and the ledger is read again here rather than
 * remembered from then, so a grant the author has since withdrawn is honoured on the window's next
 * request rather than on its next launch.
 */
export function refuseDistrustedWindow(
    window: AppWindow,
    operation: DistrustedOperation,
): string | null {
    const projectPath = windowProjectPath(window);
    return projectPath ? refuseDistrustedOperation(window.getApp(), projectPath, operation) : null;
}
