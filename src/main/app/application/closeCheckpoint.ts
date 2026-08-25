export interface CloseCheckpointFacts {
    /**
     * `versionControl.checkpointOnClose`. Only an explicit `false` is off - a missing or
     * non-boolean value means the author never answered, and the answer they never gave must not
     * be the one that loses their session.
     */
    enabled: boolean;
    /** The project the closing window named, if it named one. */
    projectPath: string | null;
    /**
     * Whether the window holds a workspace that actually came up. False while a startup is still
     * running, false when it is blocked, and false when the preflight failed - see
     * `AppWindow.hasLoadedWorkspace`.
     */
    workspaceLoaded: boolean;
}

/**
 * Whether a workspace that is closing has anything worth check pointing.
 *
 * **A workspace that never came up is the case this exists for.** Studio's startup blocks on
 * Lore's repository lock, which is exclusive and *blocking* - another Studio, or the author's own
 * `lore` CLI, holds it and the open simply waits. The window sits on its opening card, the author
 * closes it to get out of the wait, and the close then asked for a checkpoint: a Lore call that
 * queues behind the very open it is waiting on, so the window spent the whole checkpoint deadline
 * saying it was recording one before closing with nothing recorded. The wait the author closed the
 * window to escape was served to them a second time under a different name.
 *
 * Nothing is lost by skipping it. The editor never mounted, so there was no way to change
 * anything: the checkpoint would describe a working tree the author never touched in this session.
 * The same reasoning already governs the pending-save flush, whose renderer-side handler answers
 * immediately while there is no workspace context rather than leaving main to sit out its timeout.
 *
 * A window that named no project has nothing to check point either, and the setting is the
 * author's own answer to the whole question.
 */
export function shouldCheckpointOnClose(facts: CloseCheckpointFacts): boolean {
    if (!facts.enabled || !facts.workspaceLoaded) {
        return false;
    }
    return typeof facts.projectPath === "string" && facts.projectPath.length > 0;
}
