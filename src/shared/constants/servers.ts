/**
 * The servers this installation is signed in to, as a place in Settings.
 *
 * A server is signed in to once and then serves every project pointed at it, so it
 * belongs to the machine rather than to a repository. That is why it has a Settings
 * category of its own, and why the version rail sends people here instead of asking for
 * a token in a side panel.
 */

/**
 * The Settings entry the servers panel renders under, and therefore the `highlight` that
 * opens Settings on it.
 *
 * Nothing is stored here: the panel is a `SettingValueType.Custom` row, and the servers
 * themselves live in `versionControl.serverSessions`, written by the main process when a
 * sign-in succeeds.
 */
export const SERVERS_PANEL_SETTING_KEY = "servers.list";
