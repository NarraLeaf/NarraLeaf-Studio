/**
 * The naming rules behind "New Text File".
 *
 * Pure, and kept out of the action hook, because the one part of that flow with real edge cases is
 * this one: what counts as an extension. Everything else there is a dialog, a service call and a
 * tab.
 *
 * The rule this fixes: **an extension the author typed is kept, whatever it is.** `plan.md`,
 * `notes.ini` and `data.csv` are all files a team writes next to a game, and Studio is not the only
 * program that will open them. Studio's built-in editor only *opens* the extensions listed in
 * `TEXT_EDITABLE_EXTENSIONS` - a different question, and narrowing creation to that list would make
 * the asset library refuse files it is perfectly able to store.
 */

/** Appended only when the author typed no extension at all. */
export const NEW_TEXT_FILE_DEFAULT_EXTENSION = "txt";

/**
 * What a file name may not contain: both path separators, and the characters Windows reserves.
 *
 * A separator is refused rather than sanitised because it means something - the author was trying
 * to say "put it over there" - and silently flattening it to a name with no folder in it would be
 * a different outcome than the one asked for. Folders here are asset groups, not path segments.
 */
const ILLEGAL_TEXT_FILE_NAME_CHARS = /[\\/:*?"<>|]/;

/**
 * Trailing dots and spaces. Windows drops them on the way to disk, so a name ending in one is a
 * name the author would never get back; they are trimmed before the extension is looked for, which
 * is also what turns `notes.` into `notes.txt` rather than `notes..txt`.
 */
const TRAILING_NOISE = /[.\s]+$/;

export type NewTextFileNameProblem = "empty" | "illegalChars";

/**
 * Why this name cannot be used, or `null` if it can. Reason codes rather than sentences: the
 * translated strings live with the dialog that shows them.
 */
export function validateNewTextFileName(input: string): NewTextFileNameProblem | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return "empty";
  }
  if (ILLEGAL_TEXT_FILE_NAME_CHARS.test(trimmed)) {
    return "illegalChars";
  }
  // `...` survives the character check and still names nothing.
  if (!trimmed.replace(TRAILING_NOISE, "")) {
    return "empty";
  }
  return null;
}

/**
 * The name the asset is created under: the author's, with `.txt` appended only when there is no
 * extension to respect.
 *
 * A leading dot counts as an extension (`.gitignore` stays `.gitignore`), matching
 * `textFileExtension`, which the editor's own whitelist reads names with.
 */
export function resolveNewTextFileName(input: string): string {
  const name = input.trim().replace(TRAILING_NOISE, "");
  const dot = name.lastIndexOf(".");
  if (dot >= 0 && dot < name.length - 1) {
    return name;
  }
  return `${name}.${NEW_TEXT_FILE_DEFAULT_EXTENSION}`;
}
