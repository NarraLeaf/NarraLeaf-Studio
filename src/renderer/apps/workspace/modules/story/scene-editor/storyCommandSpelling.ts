import { actionTrigger, toCanonicalCommandLine } from "./commandTrigger";
import { getCommandDef, localizedCommandToken } from "./commands/registry";
import { parseCommandLine } from "./storyCommandParser";

/**
 * Re-spell a line's verb in the command language, as it is typed.
 *
 * The menu shows 显示 and the manual documents 显示, but an author who types the word they read in an
 * English tutorial - or who reaches for `@show` out of habit - was left looking at a line that said
 * something else than every other surface. Picking from the menu had the same seam from the other
 * side: the pick inserted `@show` and the committed row came back 显示, so one action produced three
 * spellings of one command. This closes it at the only place a command word is ever *displayed as
 * typed*: the insert line itself.
 *
 * **Only ever swaps one recognized spelling for another.** The token is re-spelled through
 * {@link localizedCommandToken}, which by construction returns a word the parser accepts back as this
 * very command - so the line means exactly what it meant before, and `/show`, `/enter` and `/显示`
 * converge on one word instead of three.
 *
 * **Nothing happens where the command language is English.** The rewrite is conditional on the
 * command language having a word of its own for this command: with the vocabulary in English (or
 * `editor.localizedCommands` off) the target spelling IS the canonical token, and an author who typed
 * the alias `/enter` keeps it. Aliases exist to be typed; the only thing worth correcting is a line
 * speaking a different language than the editor around it.
 */

export type RespelledCommandLine = {
  /** The line as it should now read - same trigger, same arguments, verb re-spelled. */
  value: string;
  /** Where the caret belongs in it. */
  caret: number;
};

/**
 * The line with its verb spelled in the command language, or `null` when it already is (which is the
 * overwhelmingly common case - every keystroke that is not the space after a command name).
 *
 * `value` is the DISPLAYED line, "@" trigger and all; the parse runs against the canonical form, whose
 * offsets match character for character (see `commandTrigger`), and the trigger is never touched.
 */
export function localizeCommandVerb(
  value: string,
  caret: number,
  aliasEnabled: boolean
): RespelledCommandLine | null {
  if (actionTrigger(value, aliasEnabled) === null) {
    return null;
  }
  const line = parseCommandLine(toCanonicalCommandLine(value, aliasEnabled));
  if (line.kind !== "command" || !line.token || !line.def) {
    return null;
  }
  // The verb has to be FINISHED before it can be corrected. While the token still runs to the end of
  // the line the author is mid-word, and rewriting `@sho` the instant it passes through `@show`
  // would take the line out from under them; the space that starts the next argument is the signal.
  if (line.tokenSpan.end >= value.length) {
    return null;
  }
  const spelled = localizedCommandToken(line.def);
  // Canonical target = this locale has no word of its own here. Leave the author's spelling alone.
  if (spelled === line.def.token || spelled === line.token) {
    return null;
  }
  // Guard the round trip at the point of use as well as at the point of construction: a word that
  // does not read back as this command is a word that must not be written, whatever the table says.
  if (getCommandDef(spelled)?.commandId !== line.def.commandId) {
    return null;
  }
  const { start, end } = line.tokenSpan;
  return {
    value: value.slice(0, start) + spelled + value.slice(end),
    // A caret inside the word just replaced lands after it - there is no character-for-character
    // correspondence between `show` and `显示` to preserve, and the author's next keystroke belongs
    // to whatever comes after the verb.
    caret:
      caret <= start
        ? caret
        : caret >= end
          ? caret + (spelled.length - (end - start))
          : start + spelled.length
  };
}
