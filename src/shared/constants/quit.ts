/**
 * Whether ⌘Q asks for a second gesture before Studio goes away.
 *
 * Shared because the two halves of the feature live in different processes: the Settings row is a
 * renderer registry entry, while the gesture itself can only be recognised in the main process
 * (`HoldToQuitManager`), which reads this key on every keystroke rather than caching it - a change
 * made in Settings has to apply to the next ⌘Q, not to the next launch.
 */
export const CONFIRM_QUIT_KEY = "app.confirmQuit";

/**
 * On, so an accidental ⌘Q costs nothing on the machine where it is easiest to hit by accident.
 *
 * ⌘Q sits one key away from ⌘W and ⌘A on a macOS keyboard, and Studio is an editor: the cost of
 * the wrong one being instant is a lost train of thought at best. The confirmation is a hold rather
 * than a dialog precisely because it can be defaulted on without ever standing in the way of
 * someone who meant it.
 */
export const CONFIRM_QUIT_DEFAULT = true;
