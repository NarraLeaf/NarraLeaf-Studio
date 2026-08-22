/**
 * Whether ⌘Q asks for a second press before Studio goes away.
 *
 * Shared because the two halves of the feature live in different processes: the Settings row is a
 * renderer registry entry, while the gesture itself can only be recognised in the main process
 * (`ConfirmQuitManager`), which reads this key on every keystroke rather than caching it - a change
 * made in Settings has to apply to the next ⌘Q, not to the next launch.
 */
export const CONFIRM_QUIT_KEY = "app.confirmQuit";

/**
 * On, so an accidental ⌘Q costs nothing on the machine where it is easiest to hit by accident.
 *
 * ⌘Q sits one key away from ⌘W and ⌘A on a macOS keyboard, and Studio is an editor: the cost of
 * the wrong one being instant is a lost train of thought at best. The confirmation is a second
 * press rather than a dialog precisely because it can be defaulted on without ever standing in the
 * way of someone who meant it: the answer is the same key again, not a button to find.
 */
export const CONFIRM_QUIT_DEFAULT = true;

/**
 * How long a quit waits for the closing checkpoints of the projects it is closing, in seconds.
 *
 * Shared for the same reason as the confirmation above: the Settings row is a renderer registry
 * entry, and the wait itself is main-process work (`App.checkpointOpenWorkspacesForShutdown`),
 * read at quit time so that a change applies to the next quit rather than the next launch.
 */
export const QUIT_CHECKPOINT_TIMEOUT_KEY = "versionControl.quitCheckpointTimeoutSeconds";

/**
 * Ten seconds, and the number is arithmetic rather than taste: the shutdown deadline is this plus
 * a fixed allowance for putting the version-control stores down, so the default leaves a quit
 * inside the twenty seconds it took before any of it was configurable.
 */
export const QUIT_CHECKPOINT_TIMEOUT_DEFAULT_SECONDS = 10;

/**
 * Zero waits for nothing, which is a quit that records no checkpoint at all. Left reachable
 * because it is the only way to ask for the behaviour quitting had before the checkpoint was
 * wired into it, and because a workspace closed by hand still records one either way.
 */
export const QUIT_CHECKPOINT_TIMEOUT_MIN_SECONDS = 0;

/**
 * Two minutes. Past that a quit is indistinguishable from an application that will not close, and
 * the checkpoint being waited for is one the author can record before quitting instead.
 */
export const QUIT_CHECKPOINT_TIMEOUT_MAX_SECONDS = 120;

export const QUIT_CHECKPOINT_TIMEOUT_STEP_SECONDS = 5;
