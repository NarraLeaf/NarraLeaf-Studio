/**
 * Failures the save-status surface has already put in front of the author.
 *
 * Some operations fail in two places at once. The write or read that went wrong is reported by
 * `SaveStatusService`, worded from the store's name and the filesystem's code, and the operation that
 * asked for it still has to learn that it failed, so the error is thrown on to it. A surface that
 * catches that error and shows it as well puts one failure on screen twice - the second time in the
 * error's own words, which are English and name the file by its path.
 *
 * Marking the error is how the catcher tells the two apart without matching on its message.
 * `UIService.showError` reads the mark, so every surface that hands it what it caught is covered.
 */

const REPORTED = Symbol.for("narraleaf.studio.reportedToAuthor");

type Marked = { [REPORTED]?: true };

/** Record that the author has already been told about `error`. Returns the same error, for `throw`. */
export function markReportedToAuthor<E extends Error>(error: E): E {
    (error as E & Marked)[REPORTED] = true;
    return error;
}

/** Whether `error` is one the save-status surface has already reported, so nothing else should. */
export function isReportedToAuthor(error: unknown): boolean {
    return typeof error === "object" && error !== null && (error as Marked)[REPORTED] === true;
}
