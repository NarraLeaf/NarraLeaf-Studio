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
 *
 * `debug.breakpoints.*` sits here for the same reason `ui.editor.session` does: it is per-project
 * editor session state, not a preference and not something the author would miss the way they
 * would miss their project history.
 */
export const WORKSPACE_LAYOUT_KEY_PREFIXES: readonly string[] = [
    "ui.leftSidebar.",
    "ui.rightSidebar.",
    "ui.bottomPanel.",
    "ui.editor.session",
    "ui.versionRail.",
    "uiEditor.",
    "debug.breakpoints.",
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
 * Preferences an export leaves out. Two groups, two reasons, no option to include them.
 *
 * There is deliberately no toggle: an exported settings file is a plain JSON document, and a
 * second little configuration surface governing what goes into it is more machinery than the
 * question deserves. Both groups are things the receiving machine is better off without.
 *
 * - **The wallpaper.** `ui.backgroundImage` is a file NAME inside this profile's background cache,
 *   never a path, so on another machine it names a file that does not exist; the other four keys
 *   only describe how that missing picture would be painted. Carrying the picture itself would
 *   mean putting megabytes of base64 in a settings file, which is not what a settings file is.
 * - **The identity.** The name and address recorded on commits are the author's, not the
 *   installation's, and an exported file is the kind of thing that gets attached to an issue.
 */
export const UNEXPORTED_PREFERENCE_KEYS: readonly string[] = [
    "ui.backgroundImage",
    "ui.backgroundOpacity",
    "ui.backgroundFill",
    "ui.backgroundAnchor",
    "ui.backgroundBlur",
    "versionControl.authorName",
    "versionControl.authorEmail",
];
