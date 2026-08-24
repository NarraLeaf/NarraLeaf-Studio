/**
 * How a DLC is delivered, named in one place because both ends have to agree.
 *
 * A DLC travels as a folder: the export writes into it, the author uploads it as a storefront's
 * download or zips it for a direct sale, the player ends up with it beside their game, and the game
 * looks inside it. If the writer and the reader ever disagreed about the name, an author would ship
 * a DLC that installs perfectly and does nothing - the same failure `patchDelivery` exists to
 * prevent, and the reason both live in one module each.
 *
 * A DLC is a sealed layer, exactly like a patch, and the game reads it through the same code. What
 * differs is only where it is found and what it is called, and both of those differ for the player's
 * sake: a folder called `DLC` holding `summer_DLC.pak` says what it is to somebody who has never
 * read a manual, while `patch/summer.patch.dat` does not.
 */

/** The suffix every DLC file ends with. `summer` ships as `summer_DLC.pak`. */
export const DLC_FILE_SUFFIX = "_DLC.pak";

/**
 * The folder a DLC lives in, per platform.
 *
 * Capitalised on Windows and lowercase elsewhere, following what each platform's own folders look
 * like beside it. This is a convention, not an identity: {@link dlcDirectoryCandidates} makes a
 * folder written under either spelling work anywhere, so an author who exports on one platform and
 * a player who installs on another are never separated by a letter's case.
 */
export const DLC_DIRECTORY_NAME_WINDOWS = "DLC";
export const DLC_DIRECTORY_NAME_POSIX = "dlc";

/** The spelling this platform writes. */
export function dlcDirectoryName(platform: string): string {
    return platform === "win32" ? DLC_DIRECTORY_NAME_WINDOWS : DLC_DIRECTORY_NAME_POSIX;
}

/**
 * The spellings this platform reads, preferred first.
 *
 * Both, because the author's platform and the player's need not match and a case-sensitive
 * filesystem would otherwise turn that mismatch into a DLC that is present and ignored. Windows
 * resolves either spelling to the same directory, so the second candidate simply finds nothing
 * there; on POSIX it is what makes a folder unzipped from a Windows-made archive work.
 */
export function dlcDirectoryCandidates(platform: string): string[] {
    return platform === "win32"
        ? [DLC_DIRECTORY_NAME_WINDOWS, DLC_DIRECTORY_NAME_POSIX]
        : [DLC_DIRECTORY_NAME_POSIX, DLC_DIRECTORY_NAME_WINDOWS];
}

/** What the DLC with this id ships as. */
export function dlcArtifactFileName(id: string): string {
    return `${id}${DLC_FILE_SUFFIX}`;
}

/**
 * Whether this filename is a DLC file.
 *
 * Case-insensitive on the suffix for the reason {@link dlcDirectoryCandidates} exists: a file that
 * travelled through an archive tool that folded its case is still the file the author shipped.
 *
 * The id is deliberately **not** read back out of the name. What a DLC is called is stated inside
 * the file, where renaming it cannot change the answer - a filename is the player's to edit.
 */
export function isDlcFileName(fileName: string): boolean {
    return fileName.length > DLC_FILE_SUFFIX.length
        && fileName.toLowerCase().endsWith(DLC_FILE_SUFFIX.toLowerCase());
}

/**
 * Where a DLC file is actually written, given where the author chose to put it.
 *
 * Always inside the DLC folder, because that folder is the unit of delivery: the author uploads or
 * zips it whole and the player extracts it whole. Choosing a location that is already inside one is
 * taken at face value rather than nested again, under either spelling - an author who navigated into
 * a `dlc` folder made on a Mac meant that one.
 */
export function resolveDlcDeliveryPath(
    chosen: string,
    platform: string,
    join: (...parts: string[]) => string,
    dirname: (p: string) => string,
    basename: (p: string) => string,
): string {
    const directory = dirname(chosen);
    const folded = basename(directory).toLowerCase();
    if (folded === DLC_DIRECTORY_NAME_POSIX) {
        return chosen;
    }
    return join(directory, dlcDirectoryName(platform), basename(chosen));
}
