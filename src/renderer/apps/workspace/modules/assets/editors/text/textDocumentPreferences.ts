import {
    DEFAULT_TEXT_ENCODING,
    isPersistedTextEol,
    isTextEncodingId,
    type PersistedTextEol,
    type TextEncodingId,
} from "@shared/types/textEncoding";
import type { AssetExtras } from "@/lib/workspace/services/assets/types";
import { detectLineEnding, platformDefaultLineEnding, type LineEnding } from "./textEditableFiles";

/**
 * How a text asset's encoding and line ending are decided when it is opened, and when that decision
 * is written back onto the record.
 *
 * All of it is pure and lives away from the editor component, because these are the two rules that
 * are easy to state and easy to get quietly wrong: which source wins on open, and what counts as a
 * change worth committing. A file's encoding is shared through version control, so a rule that
 * writes too eagerly turns "I read a colleague's plan" into a diff on their branch.
 */

/** What the asset record says the author decided, ignoring anything it cannot be. */
export function readTextDocumentPreferences(extras: AssetExtras | undefined): {
    encoding: TextEncodingId | null;
    lineEnding: LineEnding | null;
} {
    // Validated rather than trusted: this is a hand-editable project file, and an unknown id has to
    // degrade to "nothing recorded" rather than reach the decoder.
    const encoding = isTextEncodingId(extras?.textEncoding) ? extras.textEncoding : null;
    const eol = isPersistedTextEol(extras?.textEol) ? extras.textEol : null;
    return { encoding, lineEnding: eol ? fromPersistedEol(eol) : null };
}

export function toPersistedEol(ending: LineEnding): PersistedTextEol {
    return ending === "CRLF" ? "crlf" : "lf";
}

export function fromPersistedEol(eol: PersistedTextEol): LineEnding {
    return eol === "crlf" ? "CRLF" : "LF";
}

/**
 * Which encoding to decode this file with: what the author said, then the byte-order mark, then
 * UTF-8.
 *
 * The record outranking the BOM is deliberate and is the one order that could be argued the other
 * way. An author who chose an encoding has stated a fact about the file; a BOM is a guess the file
 * makes about itself, and a file that carries a UTF-8 mark while actually being GB18030 past the
 * first three bytes is exactly the case the author is correcting. The interlock is what makes it
 * safe: if the record's encoding produces replacement characters, nothing is written automatically
 * and the token turns red, so a stale record is visible and one click from being fixed.
 */
export function resolveOpenEncoding(
    recorded: TextEncodingId | null,
    fromBom: TextEncodingId | null,
): TextEncodingId {
    return recorded ?? fromBom ?? DEFAULT_TEXT_ENCODING;
}

/**
 * Which line ending this document uses: what the bytes do, then what the record says, then the
 * platform.
 *
 * Content outranks the record, which is the reverse of the encoding rule above, and for a reason
 * that is not symmetry-breaking for its own sake: an encoding cannot be read off the bytes at all
 * (that is the whole problem), whereas a line ending can be read off them perfectly. If the record
 * says CRLF and every line in the file ends `\n`, the record is describing a file that no longer
 * exists - someone ran the file through another tool - and honouring it would rewrite every line of
 * a colleague's document on the next keystroke.
 */
export function resolveLineEnding(text: string, recorded: LineEnding | null): LineEnding {
    return detectLineEnding(text) ?? recorded ?? platformDefaultLineEnding();
}

/**
 * Why a text document's preferences are being written down.
 *
 * `"open"` exists so that the rule "reading a file never changes it" is expressed once, in code
 * that can be tested, rather than as an absence of a call site that a later edit can undo. It is
 * the value the load path passes, and it always yields no patch.
 */
export type TextPreferenceIntent = "open" | "reopen-with" | "save-with" | "set-eol";

/**
 * The extras patch an author's decision implies, or `null` when the record already says this.
 *
 * Returns only the keys that move: a record that already reads `gbk` and is told `gbk` again is not
 * a change, and writing it anyway would mark the assets metadata dirty and put a no-op line in the
 * next commit every time someone glanced at the encoding menu.
 */
export function textPreferencePatch(
    intent: TextPreferenceIntent,
    extras: AssetExtras | undefined,
    next: { encoding?: TextEncodingId; lineEnding?: LineEnding },
): Partial<AssetExtras> | null {
    if (intent === "open") {
        return null;
    }
    const patch: Partial<AssetExtras> = {};
    if (next.encoding && next.encoding !== extras?.textEncoding) {
        patch.textEncoding = next.encoding;
    }
    if (next.lineEnding) {
        const eol = toPersistedEol(next.lineEnding);
        if (eol !== extras?.textEol) {
            patch.textEol = eol;
        }
    }
    return Object.keys(patch).length > 0 ? patch : null;
}
