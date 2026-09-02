/**
 * Handing `<project>/scripts/` to the editor the author actually writes code in.
 *
 * # Why this is not `shell.openPath(file)`
 *
 * It was, and that was wrong twice over.
 *
 * `shell.openPath` runs the file through the OS association table, and on Windows `.ts` is very
 * often owned by a media player - on the machine this was found on, `.ts` and `.mp4` resolve to the
 * same handler. `openPath` then answers with an empty string, which means success, so Studio had no
 * way to know the author's script had just opened in a video app.
 *
 * And even where the association is an editor, opening the *file* is the wrong unit. A script
 * type-checks against `scripts/tsconfig.json` and the declarations in `scripts/.narraleaf/`, and an
 * editor resolves those from the folder it has open. Opening one file leaves `@narraleaf/script`
 * unresolved and the author's first line underlined in red.
 *
 * So the folder is what is opened, the file is passed alongside it where the editor takes one, and
 * which editor is a choice offered from what this machine actually has.
 *
 * # The command list is closed
 *
 * The renderer names an editor by id, never a command line. Everything launched here comes from
 * {@link KNOWN_EDITORS}, is resolved on PATH here rather than taken from the caller, and is given
 * exactly two arguments, both of them paths inside the author's own project.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type { ExternalScriptEditor } from "@shared/types/scriptEditors";

const execFileAsync = promisify(execFile);

/**
 * The editors Studio knows how to launch, in the order they are offered.
 *
 * Each takes `<folder> [file]` and needs no flags for it, which is why one shape covers all of them:
 * the VS Code family reads that as "open this folder, then this file in it", and so do Sublime, Zed
 * and the JetBrains launchers. An editor that needed its own argv would need its own entry here
 * rather than a special case at the call site.
 */
const KNOWN_EDITORS: readonly { id: string; name: string; command: string }[] = [
    { id: "code", name: "Visual Studio Code", command: "code" },
    { id: "cursor", name: "Cursor", command: "cursor" },
    { id: "code-insiders", name: "Visual Studio Code Insiders", command: "code-insiders" },
    { id: "windsurf", name: "Windsurf", command: "windsurf" },
    { id: "zed", name: "Zed", command: "zed" },
    { id: "subl", name: "Sublime Text", command: "subl" },
    { id: "webstorm", name: "WebStorm", command: "webstorm" },
    { id: "idea", name: "IntelliJ IDEA", command: "idea" },
];

/** How a command is looked up on this platform. Injected so the tests need no editors installed. */
export type PathLookup = (command: string) => Promise<string | null>;

/**
 * Where a command lives, or null.
 *
 * `where` on Windows, `which` elsewhere; both exit non-zero when nothing is found. The *path* is
 * kept rather than a yes/no because launching needs it: on Windows the thing on PATH is usually a
 * `.cmd` shim, and knowing that is what decides how it can be started at all.
 */
async function lookUpOnPath(command: string, platform: NodeJS.Platform): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync(platform === "win32" ? "where" : "which", [command], {
            windowsHide: true,
        });
        // `where` prints every match, one per line; the first is what would run.
        const first = stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean);
        return first ?? null;
    } catch {
        return null;
    }
}

/**
 * The editors this machine can open a folder in.
 *
 * Probed rather than assumed: an entry offered for an editor that is not installed is a button that
 * fails. The two targets that always work - the file manager, and the OS association - are not
 * editors and are added by the caller rather than probed here.
 */
export async function detectExternalScriptEditors(
    platform: NodeJS.Platform = process.platform,
    lookUp: PathLookup = command => lookUpOnPath(command, platform),
): Promise<ExternalScriptEditor[]> {
    const found: ExternalScriptEditor[] = [];
    for (const editor of KNOWN_EDITORS) {
        if (await lookUp(editor.command)) {
            found.push({ id: editor.id, name: editor.name });
        }
    }
    return found;
}

/** Whether an id names one of the editors above. */
export function isKnownExternalScriptEditor(id: string): boolean {
    return KNOWN_EDITORS.some(editor => editor.id === id);
}

/**
 * A path `cmd.exe` can be handed inside a quoted command line without changing meaning.
 *
 * Windows filenames cannot contain `"`, so quoting is enough for everything except `%`, which cmd
 * expands even inside quotes. A project path with a `%` in it is rare and the honest answer is to
 * decline rather than to open something else, so the caller falls back to the file manager.
 */
function isSafeForCmdLine(value: string): boolean {
    return !value.includes('"') && !value.includes("%");
}

/** What to spawn, once the decision below has been made. */
export type EditorLaunch = {
    file: string;
    args: string[];
    /**
     * True when `args` is one already-quoted command line rather than separate arguments - the shape
     * `cmd.exe` needs, and the reason this decision is a value rather than a branch inside a spawn.
     */
    verbatim: boolean;
};

/**
 * How this machine starts that editor on that folder.
 *
 * Two ways in, decided by what PATH actually resolved to. A real executable is started directly with
 * an argument array, which no filename can turn into a command. A `.cmd` or `.bat` shim - which is
 * what the VS Code family installs - cannot be started that way at all on Windows, so it goes
 * through `cmd.exe /c` with a command line built and quoted here, rather than letting Node's own
 * quoting meet a batch file's parser.
 *
 * Separated from the spawn so it can be read and tested as the decision it is; the process this
 * describes is started by {@link openFolderInExternalEditor}.
 */
export function buildEditorLaunch(input: {
    resolved: string;
    directory: string;
    file?: string;
    platform: NodeJS.Platform;
    editorName: string;
}): EditorLaunch {
    const args = input.file ? [input.directory, input.file] : [input.directory];
    if (input.platform === "win32" && /\.(cmd|bat)$/i.test(input.resolved)) {
        if (![input.resolved, ...args].every(isSafeForCmdLine)) {
            throw new Error(`${input.editorName} cannot be launched for a path containing % or "`);
        }
        // The outer pair is not decoration: `cmd /c` strips the first and last quote of its
        // argument, so a command line that is itself quoted needs one pair to lose.
        const line = `"${[input.resolved, ...args].map(part => `"${part}"`).join(" ")}"`;
        return { file: process.env.ComSpec || "cmd.exe", args: ["/c", line], verbatim: true };
    }
    return { file: input.resolved, args, verbatim: false };
}

/** Launch an editor on the scripts folder. */
export async function openFolderInExternalEditor(input: {
    editorId: string;
    directory: string;
    /** Opened inside the folder, where the editor takes a second argument. */
    file?: string;
    platform?: NodeJS.Platform;
    lookUp?: PathLookup;
}): Promise<void> {
    const editor = KNOWN_EDITORS.find(known => known.id === input.editorId);
    if (!editor) {
        throw new Error(`Unknown editor: ${input.editorId}`);
    }
    const platform = input.platform ?? process.platform;
    const lookUp = input.lookUp ?? (command => lookUpOnPath(command, platform));
    const resolved = await lookUp(editor.command);
    if (!resolved) {
        throw new Error(`${editor.name} is not on this machine's PATH`);
    }
    const launch = buildEditorLaunch({
        resolved,
        directory: input.directory,
        file: input.file,
        platform,
        editorName: editor.name,
    });
    await execFileAsync(launch.file, launch.args, {
        windowsHide: true,
        windowsVerbatimArguments: launch.verbatim,
    });
}
