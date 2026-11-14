/**
 * Whether the signed-in Team account is drawn in the workspace title bar.
 *
 * Shared by the settings registry and the title bar so the key and the default cannot drift apart.
 * The setting only has an effect while a window has a session with a Team server: without one
 * there is no account to draw, and the settings row is disabled until this machine is signed in to
 * a server.
 */
export const TEAM_AVATAR_VISIBLE_KEY = "ui.teamAvatar.visible";

export const TEAM_AVATAR_VISIBLE_DEFAULT = true;
