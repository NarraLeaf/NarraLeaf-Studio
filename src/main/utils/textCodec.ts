import iconv from "iconv-lite";
import {
  type FsTextEncoding,
  type TextEncodingId,
  isTextEncodingId
} from "@shared/types/textEncoding";

/**
 * Transcoding between text and bytes for the encodings Studio's text editor offers.
 *
 * **Main-process only, and deliberately not in `@shared`.** It imports `iconv-lite`, which needs
 * `Buffer`; the renderer gets the ids, the labels and the BOM sniff from
 * `@shared/types/textEncoding` and asks the main process to do the actual conversion
 * (`FileSystemService.read`/`write` carry the encoding through to `FileSystemHashHandler`).
 *
 * Living here rather than next to `Fs` in `@shared/utils/fs` is what keeps iconv-lite's ~230 KB of
 * codepage tables out of the *game* runtime bundle: `src/runtime/main` imports `getMimeType` from
 * that module, so anything reachable from it is shipped inside every packaged game, which has no
 * use for GBK at all.
 *
 * Two rules the table below encodes, and both matter for round-tripping:
 *
 *  - **The BOM is the codec's business, never the caller's.** Decoding always strips the mark, so
 *    a document never carries a U+FEFF that would show up as a stray glyph in the editor, get
 *    counted in the column number, and be written back doubled. Encoding puts it back for exactly
 *    the encodings that conventionally carry one.
 *  - **Only ids we can name go through here.** `resolveTextEncodingId` answers null for the rest
 *    (`base64`, `hex`, `ascii`), and `Fs` falls back to Node's own handling for those - this is a
 *    widening of the file-system verbs, not a replacement of them.
 */

type TextCodecSpec = {
  /** Node's own name, when Node can do it faster and identically. */
  node?: BufferEncoding;
  /** iconv-lite's canonical name, for everything Node cannot name. */
  iconv?: string;
  /** The byte-order mark written on encode and stripped on decode. */
  bom?: readonly number[];
};

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const UTF16LE_BOM = [0xff, 0xfe] as const;
const UTF16BE_BOM = [0xfe, 0xff] as const;

const TEXT_CODECS: Record<TextEncodingId, TextCodecSpec> = {
  utf8: { node: "utf8" },
  utf8bom: { node: "utf8", bom: UTF8_BOM },
  utf16le: { node: "utf16le", bom: UTF16LE_BOM },
  utf16be: { iconv: "utf16-be", bom: UTF16BE_BOM },
  gbk: { iconv: "gbk" },
  gb18030: { iconv: "gb18030" },
  big5: { iconv: "big5" },
  shiftjis: { iconv: "shift_jis" },
  euckr: { iconv: "euc-kr" },
  windows1252: { iconv: "windows-1252" },
  iso88591: { iconv: "iso-8859-1" }
};

/**
 * The Studio encoding id an `FsTextEncoding` names, or null when this codec has no opinion and
 * the caller should use Node's own encoding handling.
 *
 * `"latin1"`, `"binary"`, `"ascii"`, `"base64"` and friends deliberately fall through: they are
 * either byte transports rather than text encodings, or Node handles them with edge-case
 * behaviour (silent truncation above U+00FF) that existing callers already depend on.
 */
export function resolveTextEncodingId(encoding: FsTextEncoding | undefined): TextEncodingId | null {
  if (encoding === undefined) {
    return null;
  }
  if (isTextEncodingId(encoding)) {
    return encoding;
  }
  if (encoding === "utf-8") {
    return "utf8";
  }
  if (encoding === "utf-16le") {
    return "utf16le";
  }
  return null;
}

function stripBom(bytes: Buffer, bom: readonly number[] | undefined): Buffer {
  if (!bom || bytes.length < bom.length) {
    return bytes;
  }
  for (let i = 0; i < bom.length; i++) {
    if (bytes[i] !== bom[i]) {
      return bytes;
    }
  }
  return bytes.subarray(bom.length);
}

/**
 * Bytes to text.
 *
 * A UTF-8 mark is stripped even when the caller asked for plain `utf8`: the two ids describe the
 * same bytes, and a document opened as UTF-8 that happens to have a mark must not show it. What
 * distinguishes them is only what {@link encodeTextBytes} writes back.
 */
export function decodeTextBytes(bytes: Buffer | Uint8Array, encoding: TextEncodingId): string {
  const spec = TEXT_CODECS[encoding];
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const body = stripBom(stripBom(buffer, spec.bom), encoding === "utf8" ? UTF8_BOM : undefined);
  if (spec.node) {
    return body.toString(spec.node);
  }
  return iconv.decode(body, spec.iconv!);
}

/**
 * Text to bytes.
 *
 * A leading U+FEFF in `text` is dropped before encoding rather than passed through. Nothing in
 * Studio produces one - decoding strips it - but a paste from another editor can, and encoding it
 * as content would grow a second mark on every save.
 */
export function encodeTextBytes(text: string, encoding: TextEncodingId): Buffer {
  const spec = TEXT_CODECS[encoding];
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const encoded = spec.node ? Buffer.from(body, spec.node) : iconv.encode(body, spec.iconv!);
  return spec.bom ? Buffer.concat([Buffer.from(spec.bom), encoded]) : encoded;
}
