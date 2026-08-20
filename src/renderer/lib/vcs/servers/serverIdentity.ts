import type { VcsServerSession } from "@shared/types/vcs";

/**
 * How a server is named, and how it is identified - which are not the same thing.
 *
 * **The origin is the identity key.** Every stored session, every project's remote and
 * every `data-server-choice` in an acceptance script is keyed on `lore://host:port`, and
 * that must not change because a deployment was renamed. It is a poor thing to read,
 * though: a room of authors is handed a name in a chat message and then shown a port
 * number, and two servers on one host are told apart by digits.
 *
 * So the two are separated here. {@link serverDisplayName} is what a person reads;
 * {@link serverHost} is the address under it, shown as a second line rather than instead
 * of the name. Nothing in this file is a key.
 */

/**
 * The part of an address worth reading: the host and port, without the scheme.
 *
 * The scheme is always `lore://` and says nothing; the host is what tells two servers
 * apart. Falls back to the whole string rather than to nothing when it does not parse -
 * an author typed it, so showing it back verbatim is more useful than a blank where
 * their server should be.
 *
 * Takes a project's whole remote as happily as an origin: `lore://host:41337/my-game`
 * reads as `host:41337`, because the name after the port belongs to the project rather
 * than to the machine.
 */
export function serverHost(url: string): string {
    const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim());
    return match ? match[1] : url.trim();
}

/**
 * What to call a server on screen.
 *
 * The name it gave when it was added, and the address when it gave none - which is every
 * session stored before Studio kept the name, and no reason to ask anybody to sign in
 * again. `vcs.refreshServer` is what turns the second case into the first.
 */
export function serverDisplayName(session: VcsServerSession): string {
    return session.name?.trim() || serverHost(session.remoteOrigin);
}
