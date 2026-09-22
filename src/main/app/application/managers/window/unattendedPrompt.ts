import { describeUnattendedRefusal, type CommandLineRunEvent } from "@shared/types/commandLineRun";
import type { PluginPermissionRequest } from "@shared/types/pluginPermissions";

/**
 * A window with nobody at the screen may not ask anybody anything.
 *
 * `--build`, `--test` and `--lint` open a project in a window that is never shown (see
 * `WindowConfig.unattended`). Everything that would put a question in front of a person - a file
 * picker, a plugin's permission prompt - waits for the answer, and in that window the answer never
 * comes: the run sits until its thirty-minute silence deadline with a prompt on a screen nobody
 * reads, or on a build agent no screen at all.
 *
 * So the question is refused where it would be asked, and the run is ended on the spot with a line
 * saying who asked for what. Ended rather than merely refused, because the asker may swallow the
 * refusal and carry on: a check that could not ask what the person at a screen would have been asked
 * has not answered the question it was run for, and letting it pass would report a green run on a
 * path nobody takes.
 */

/** The two things a refusal needs from a window. `AppWindow` is one. */
export type UnattendedPromptTarget = {
    isUnattended(): boolean;
    reportCommandLineRunEvent(event: CommandLineRunEvent): void;
};

/**
 * Refuse `what` in an unattended window: end its run with an `environment` refusal, and throw so the
 * caller answers its own request with a failure instead of waiting. Does nothing anywhere else.
 */
export function refuseUnattendedPrompt(
    target: UnattendedPromptTarget,
    what: string,
    warn?: (message: string) => void,
): void {
    if (!target.isUnattended()) {
        return;
    }
    const message = describeUnattendedRefusal(what);
    warn?.(message);
    target.reportCommandLineRunEvent({ kind: "finished", ok: false, refusal: "environment", error: message });
    throw new Error(message);
}

/** A plugin's permission prompt, by the plugin's name and version. */
export function describePermissionAsker(request: PluginPermissionRequest): string {
    const name = request.plugin.name?.trim() || request.plugin.id;
    const plugin = `The plugin "${name}"${request.plugin.version ? ` ${request.plugin.version}` : ""}`;
    switch (request.kind) {
        case "install":
            return `${plugin} needs its permissions approved before it can be installed`;
        case "filesystem":
            return `${plugin} asked for access to ${request.path}`;
        case "api":
            return `${plugin} asked for permission to use ${request.capability}`;
        default:
            return `${plugin} asked to be trusted`;
    }
}

/** A file or folder picker, by its title when it has one. */
export function describeFileDialog(kind: "open" | "save", title: string | undefined): string {
    const picker = kind === "open" ? "a file picker" : "a save dialog";
    return `Something in this run asked for ${picker}${title?.trim() ? ` ("${title.trim()}")` : ""}`;
}
