/**
 * Which global-state keys are preferences, and which are something else living in the same file.
 *
 * `global.json` is one store holding four different kinds of thing: preferences, the project
 * history, per-project editor sessions, and per-project statistics. A real profile here measured
 * 96 keys, of which only about 30 are preferences. So "reset my settings" and "export my settings"
 * cannot be expressed as "everything in the store" - they need a declared scope, which is this
 * file.
 *
 * Patterns are prefixes, matched with `startsWith`, plus exact ids. Deliberately not globs: every
 * grouping here is a literal namespace the writer chose, and a pattern language would invite
 * cleverness where a list is clearer.
 */

/**
 * Never deletable, whatever a caller asks for. Enforced in the main process, so a renderer bug
 * cannot take these with it.
 *
 * - `app.recentProjects` is the project history. Losing it is not a preference reset; on macOS it
 *   also carries the security-scoped bookmarks that make those projects openable at all.
 * - `stats.project.*` is the writing history, active time and build history of every project.
 *   There is already a deliberate, separately-confirmed action for erasing it
 *   (`dashboard.clearAllStats`), which is where that decision belongs.
 */
export const PROTECTED_STATE_KEYS: readonly string[] = [
    "app.recentProjects",
];

export const PROTECTED_STATE_KEY_PREFIXES: readonly string[] = [
    "stats.project.",
];

export function isProtectedStateKey(key: string): boolean {
    return (
        PROTECTED_STATE_KEYS.includes(key) ||
        PROTECTED_STATE_KEY_PREFIXES.some(prefix => key.startsWith(prefix))
    );
}

/**
 * Where the workspace keeps its shape: dock visibility and widths, panel order, which editor tabs
 * were open per project, the UI editor's viewport and outline state.
 *
 * Its own reset scope rather than part of the preferences one, because "my panels went weird" and
 * "put my preferences back" are different requests and answering one with the other is how a
 * reset button becomes something people are afraid of.
 */
export const WORKSPACE_LAYOUT_KEY_PREFIXES: readonly string[] = [
    "ui.leftSidebar.",
    "ui.rightSidebar.",
    "ui.bottomPanel.",
    "ui.editor.session",
    "ui.versionRail.",
    "uiEditor.",
];

export const WORKSPACE_LAYOUT_KEYS: readonly string[] = [
    "ui.compactMode",
];

export function isWorkspaceLayoutKey(key: string): boolean {
    return (
        WORKSPACE_LAYOUT_KEYS.includes(key) ||
        WORKSPACE_LAYOUT_KEY_PREFIXES.some(prefix => key.startsWith(prefix))
    );
}

/**
 * Preferences with no row in the settings registry, which therefore have to be named here for
 * reset and export to see them.
 *
 * Each is a real preference the product reads - they are absent from the registry because they
 * are set by a gesture rather than by a field (the Run button's dropdown, the background dialog,
 * the star on an action), not because they are internal state.
 */
export const NON_REGISTRY_PREFERENCE_KEYS: readonly string[] = [
    "ui.runMode",
    "ui.backgroundImage",
    "ui.backgroundOpacity",
    "ui.backgroundFill",
    "ui.backgroundAnchor",
    "ui.backgroundBlur",
    "story.actionCreator.starredActionIds",
];

/**
 * Preferences that describe *this machine* and are wrong on another one.
 *
 * `ui.backgroundImage` is a file name inside this profile's background cache, so it names a
 * picture the other machine does not have; the rest of the `ui.background*` keys are how it is
 * displayed, and carrying them without the picture would leave settings describing nothing.
 * Excluded from an export by default rather than dropped, because an author moving to a machine
 * they will re-pick the wallpaper on may still want the rest.
 */
export const MACHINE_SPECIFIC_PREFERENCE_KEYS: readonly string[] = [
    "ui.backgroundImage",
    "ui.backgroundOpacity",
    "ui.backgroundFill",
    "ui.backgroundAnchor",
    "ui.backgroundBlur",
];

/**
 * Preferences that identify a person rather than configure a program.
 *
 * Wanted on a second machine, and exactly the thing not to hand over when the exported file is
 * going to a colleague - so they are an opt-in at export time instead of a silent inclusion.
 */
export const PERSONAL_PREFERENCE_KEYS: readonly string[] = [
    "versionControl.authorName",
    "versionControl.authorEmail",
];
