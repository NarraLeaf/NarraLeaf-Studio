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

/**
 * The product a Studio project is shared through, spelled once.
 *
 * **A name rather than a string in a catalog.** It is identical in every language, so putting it
 * in the three i18n files would be three copies of one fact and three chances for one of them to
 * drift. Anything a person reads that has to say the product's name reads it from here.
 *
 * The short form in running prose is "Team", and a machine is "a Team server" - never "a Team",
 * which reads as a group of colleagues. That distinction is in the catalog copy; this constant is
 * only ever the full name.
 */
export const NARRALEAF_TEAM = "NarraLeaf Team";
