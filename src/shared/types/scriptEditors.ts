/**
 * Where a project's scripts can be opened.
 *
 * `<project>/scripts/` is the one directory Studio does not own (see `@shared/project/scriptsDirectory`),
 * so the affordance over it is "hand this folder to something else". What that something can be is
 * two fixed targets every machine has plus whatever editors are actually installed, which only the
 * main process can find out.
 */

/** One editor this machine can launch, as the renderer offers it. */
export type ExternalScriptEditor = {
    /** Stable id the renderer sends back; never a command line. */
    id: string;
    /** The editor's own name, not translated - "Cursor" is called Cursor in every locale. */
    name: string;
};

/**
 * The two targets that need no editor.
 *
 * `reveal` shows the file in the OS file manager, which is the answer when the author's editor is
 * not on PATH. `system` hands the *folder* to the OS association, which opens the file manager on
 * every platform - the folder rather than the file, because a `.ts` file's association is often a
 * media player.
 */
export type ExternalScriptEditorTargetId = "reveal" | "system";

/** What the renderer sends: a detected editor's id, or one of the two built-in targets. */
export type ScriptOpenTargetId = string | ExternalScriptEditorTargetId;
