/**
 * The character encodings Studio's text editor can read and write a file in.
 *
 * This module is deliberately dependency-free and `Buffer`-free: it is imported by the renderer
 * (which needs the list, the labels and the BOM sniff) as well as by the main process. The actual
 * transcoding lives in `@shared/utils/textCodec`, which pulls in `iconv-lite` and therefore must
 * never be reachable from a renderer bundle.
 *
 * `utf8` and `utf8bom` are two ids for one encoding on purpose. They decode identically, so the
 * distinction only exists on the way out - and it has to exist, because "keep the BOM this file
 * arrived with" is the difference between a plan.md that another tool still opens and one it
 * suddenly reports as starting with a stray character.
 */
export type TextEncodingId =
    | "utf8"
    | "utf8bom"
    | "utf16le"
    | "utf16be"
    | "gbk"
    | "gb18030"
    | "big5"
    | "shiftjis"
    | "euckr"
    | "windows1252"
    | "iso88591";

/**
 * The encoding argument the file-system verbs accept.
 *
 * A widening rather than a replacement: every existing caller passes a Node `BufferEncoding`
 * (`"utf-8"` in practice), and those keep working unchanged. Only the ids Node cannot name -
 * GBK, Shift_JIS, a UTF-8 that must keep its BOM - route through the iconv-lite codec.
 */
export type FsTextEncoding = BufferEncoding | TextEncodingId;

/** Menu order: the two defaults first, then the CJK families, then the Latin single-bytes. */
export const TEXT_ENCODING_IDS: readonly TextEncodingId[] = [
    "utf8",
    "utf8bom",
    "utf16le",
    "utf16be",
    "gbk",
    "gb18030",
    "big5",
    "shiftjis",
    "euckr",
    "windows1252",
    "iso88591",
];

/**
 * How an encoding is written in the status bar and the menus.
 *
 * Not translated, and not going to be: these are the names the rest of the industry prints
 * (VS Code, every text editor's status bar, the HTTP charset registry). A localized "简体中文
 * 国标" would be a name nobody could match against the tool they are sharing the file with.
 */
export const TEXT_ENCODING_LABELS: Record<TextEncodingId, string> = {
    utf8: "UTF-8",
    utf8bom: "UTF-8 with BOM",
    utf16le: "UTF-16 LE",
    utf16be: "UTF-16 BE",
    gbk: "GBK",
    gb18030: "GB18030",
    big5: "Big5",
    shiftjis: "Shift_JIS",
    euckr: "EUC-KR",
    windows1252: "Windows-1252",
    iso88591: "ISO-8859-1",
};

/** Studio's answer when nothing says otherwise, for every extension. */
export const DEFAULT_TEXT_ENCODING: TextEncodingId = "utf8";

export function isTextEncodingId(value: unknown): value is TextEncodingId {
    return typeof value === "string" && (TEXT_ENCODING_IDS as readonly string[]).includes(value);
}

export function textEncodingLabel(id: TextEncodingId): string {
    return TEXT_ENCODING_LABELS[id];
}

/**
 * The encoding a byte-order mark declares, or null when there is none.
 *
 * This is the only detection Studio does. Guessing an encoding from the byte histogram is a
 * coin-flip that silently mangles a file the author then saves back over, so a UTF-8 decode that
 * produces replacement characters is left on screen - visibly wrong, and one menu click from
 * being reopened correctly - rather than quietly "corrected" to whatever GBK made of it.
 *
 * UTF-16 BE is checked before UTF-16 LE only because their marks are byte-reversed pairs and the
 * order of the two tests is what decides `FF FE`; both are complete two-byte tests, so the
 * ordering below is the actual disambiguation, not a shortcut.
 */
export function detectTextEncodingFromBom(bytes: Uint8Array): TextEncodingId | null {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return "utf8bom";
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return "utf16be";
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return "utf16le";
    }
    return null;
}

/** Whether a decoded document is expected to carry a byte-order mark when written back. */
export function textEncodingHasBom(id: TextEncodingId): boolean {
    return id === "utf8bom" || id === "utf16le" || id === "utf16be";
}
