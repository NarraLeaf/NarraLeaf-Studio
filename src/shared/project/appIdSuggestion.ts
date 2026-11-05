import { deriveGameAppId } from "../types/gameBuild";

/**
 * The app ID a new project is offered, and when two projects' IDs are the same one.
 *
 * An app ID is permanent: it names the released game on players' machines - its data folder, its
 * single-instance lock, the installer's idea of which game it is upgrading, the mobile package - and
 * a project cannot change it once it exists. So the only place a collision can be prevented is the
 * suggestion, before the project is written. Two writers make projects, the project wizard and the
 * agent endpoint's `project_create`, and both suggest through here.
 *
 * Two rules, both about the suggestion and never about an ID somebody typed:
 *
 * - **It starts with the author's name, when Studio knows one** (`leaf-studio-my-game`). A bare ID is
 *   filed under NarraLeaf's namespace, which every author shares, so "my-game" from two authors is
 *   the same game on a player's machine. The author line is what this installation was set up with
 *   (the organisation asked at first run, or the wizard's Author field); it is the name an author
 *   already gave as theirs, so the ID reads as "who and what" without anyone inventing a domain.
 * - **It is not one another project on this machine already uses.** A number is added (`my-game-2`),
 *   the way a copied file is numbered.
 *
 * Comments in English per project convention.
 */

/** Longest suggestion, matching the slug rule both writers apply to a name. */
const APP_ID_MAX_LENGTH = 50;
/** The author's share of a suggestion, so a long organisation name leaves room for the game's. */
const AUTHOR_PREFIX_MAX_LENGTH = 24;

/**
 * Whether a new project may be given this app ID as written: a bare lower-case name (`my-game`),
 * which a build files under NarraLeaf's namespace, or a lower-case reverse-domain ID
 * (`com.studio.game`), which a build uses verbatim - held to the pattern `deriveGameAppId` takes as
 * it is, so no part is empty or ends in a hyphen. A dot also never ends the name of the project's
 * folder, which is named after this ID and which Windows would silently shorten.
 */
export function isValidNewAppId(appId: string): boolean {
    return /^[a-z0-9-]+$/.test(appId)
        || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(appId);
}

/**
 * What two projects are compared by: the app ID a build ships with, case folded.
 *
 * `my-game` and `com.narraleaf.games.my-game` are one game to a player's machine, and so is a
 * project with no ID at all and one whose ID is the slug of its name - so the comparison goes
 * through `deriveGameAppId`, the function the build itself uses, rather than comparing the stored
 * strings. Case is folded because a data folder on Windows or macOS does not tell the two apart.
 */
export function appIdCollisionKey(identifier: string | undefined, projectName: string): string {
    return deriveGameAppId(identifier, projectName).toLowerCase();
}

/**
 * The text of an author line worth making an ID from.
 *
 * The line is free text, and the field's own placeholder invites an e-mail address. An address is
 * not put in a game's ID: it is taken out, and if nothing else is left the part before the `@` is
 * used, which is the name the address is under.
 */
export function authorNameForAppId(author: string): string {
    const text = author.trim();
    const addresses = text.match(/[^\s<>()]+@[^\s<>()]+/g) ?? [];
    const rest = text.replace(/[^\s<>()]+@[^\s<>()]+/g, " ").replace(/[<>()]/g, " ").trim();
    if (rest) {
        return rest;
    }
    return addresses[0]?.split("@")[0] ?? "";
}

/**
 * `gameSlug` with `authorSlug` in front, both already slugs.
 *
 * Nothing is added when there is no author, when the game's slug already starts with the author's
 * (a studio named "Leaf" making "Leaf Days"), or for an ID that is already reverse-domain - one of
 * those is somebody's own namespace already.
 */
export function prefixAppIdWithAuthor(gameSlug: string, authorSlug: string): string {
    const author = trimSlug(authorSlug.slice(0, AUTHOR_PREFIX_MAX_LENGTH));
    if (!gameSlug || !author || gameSlug.includes(".") || gameSlug === author || gameSlug.startsWith(`${author}-`)) {
        return gameSlug;
    }
    return trimSlug(`${author}-${gameSlug}`.slice(0, APP_ID_MAX_LENGTH));
}

/**
 * `base`, or the first of `base-2`, `base-3`, ... that `isTaken` does not claim.
 *
 * For a reverse-domain ID the number goes on its last part (`com.studio.game-2`), which keeps it a
 * reverse-domain ID. An empty base stays empty: the field is then the author's to fill.
 */
export function uniqueAppId(base: string, isTaken: (candidate: string) => boolean): string {
    if (!base || !isTaken(base)) {
        return base;
    }
    for (let number = 2; number < 10_000; number++) {
        const suffix = `-${number}`;
        const candidate = `${trimSlug(base.slice(0, APP_ID_MAX_LENGTH - suffix.length))}${suffix}`;
        if (!isTaken(candidate)) {
            return candidate;
        }
    }
    return base;
}

/** A slug cut short can end on a hyphen or a dot, which no app ID may. */
function trimSlug(slug: string): string {
    return slug.replace(/[-.]+$/, "");
}
