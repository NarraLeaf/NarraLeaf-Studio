/**
 * How a patch is delivered, named in one place because both ends have to agree.
 *
 * A patch travels as a folder: the export writes into it, the author zips it, the
 * player extracts it into the game's own folder, and the game looks inside it. If
 * the writer and the reader ever disagreed about the name, an author would ship a
 * patch that installs perfectly and does nothing.
 */

/** The folder a patch lives in, at the author's end and the player's alike. */
export const PATCH_DIRECTORY_NAME = "patch";

/**
 * Where a patch is actually written, given where the author chose to put it.
 *
 * Always inside a `patch` folder, because that folder is the unit of delivery:
 * the author zips it whole and the player extracts it whole. Choosing a location
 * that is already inside one is taken at face value rather than nested again.
 */
export function resolvePatchDeliveryPath(chosen: string, join: (...parts: string[]) => string, dirname: (p: string) => string, basename: (p: string) => string): string {
    const directory = dirname(chosen);
    if (basename(directory).toLowerCase() === PATCH_DIRECTORY_NAME) {
        return chosen;
    }
    return join(directory, PATCH_DIRECTORY_NAME, basename(chosen));
}
