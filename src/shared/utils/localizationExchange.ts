/**
 * Translation exchange: the file formats a project's text leaves and re-enters
 * Studio in, so the person translating it never has to open Studio at all.
 *
 * Four formats, one row model. Which one a project uses is a fact about the
 * translator, not about the project: a freelancer wants a spreadsheet, a
 * gettext-shaped team wants PO in Poedit, an agency wants XLIFF in its CAT
 * tool, and a script or a model wants JSON. All four carry the same six fields
 * and rejoin at {@link TranslationExchangeRow}, so the import path below the
 * parser is one path.
 *
 * **The unit id is the anchor, in every format.** Not the source text - two
 * lines can read identically and mean different things, and an author editing a
 * line must not orphan its translation. Formats that have a place for an
 * external id use it (XLIFF `trans-unit/@id`, PO `msgctxt`); the others carry
 * it in a column or a key.
 *
 * `{0}`-style placeholders travel as literal text in every format. Turning them
 * into XLIFF inline codes would read better in a CAT tool and would break every
 * other path, since the round-trip has to survive a translator who retyped the
 * line in Excel.
 *
 * Comments in English per project convention.
 */

import { parseTranslationCsv, serializeTranslationCsv } from "./localizationCsv";
import { parseTranslationJson, serializeTranslationJson } from "./localizationJsonExchange";
import { parseTranslationPo, serializeTranslationPo } from "./localizationPo";
import { parseTranslationXliff, serializeTranslationXliff } from "./localizationXliff";

export const TRANSLATION_EXCHANGE_FORMATS = ["csv", "xliff", "po", "json"] as const;

export type TranslationExchangeFormat = (typeof TRANSLATION_EXCHANGE_FORMATS)[number];

/**
 * One translation unit as it travels between Studio and a translator.
 *
 * `status` is a plain string rather than a union because it arrives from
 * outside: a tool that writes something Studio does not know must not cost the
 * file its translations. {@link normalizeExchangeStatus} decides what an
 * unrecognised value means, once, at the edge.
 */
export type TranslationExchangeRow = {
  unitId: string;
  /** Where this line lives, for the translator to read. Never round-tripped into the project. */
  context: string;
  source: string;
  target: string;
  status: string;
  note: string;
};

/** What Studio writes out: the rows plus the two language tags that name them. */
export type TranslationExchangeDocument = {
  sourceLocale: string;
  targetLocale: string;
  /** Optional project name, written where the format has a place for it. */
  projectName?: string;
  rows: readonly TranslationExchangeRow[];
};

export type ParsedTranslationExchange = {
  rows: TranslationExchangeRow[];
  /**
   * Language tags the file declared, when it carries them. Used to catch the
   * expensive mistake - French landing in the German file - which is silent
   * otherwise, because unit ids match perfectly across languages.
   */
  sourceLocale?: string;
  targetLocale?: string;
  /** Problems worth telling the author about. Rows may still be present. */
  errors: string[];
};

/**
 * The translation state vocabulary, shared by all four formats.
 *
 * `""` is untranslated. `stale` is derived, never stored: it means the source
 * text moved after the translation was written, and it exists here because an
 * export has to be able to say so to the translator.
 */
export type TranslationExchangeState = "" | "machine" | "translated" | "reviewed" | "stale";

const KNOWN_STATES: readonly TranslationExchangeState[] = [
  "machine",
  "translated",
  "reviewed",
  "stale"
];

/** Coerce whatever a file said into the shared vocabulary; anything unknown is untranslated. */
export function normalizeExchangeStatus(value: string | undefined): TranslationExchangeState {
  const normalized = (value ?? "").trim().toLowerCase();
  return KNOWN_STATES.includes(normalized as TranslationExchangeState)
    ? (normalized as TranslationExchangeState)
    : "";
}

export type TranslationExchangeFormatInfo = {
  /** Extension used when writing (no dot). */
  extension: string;
  /** Every extension accepted when reading (no dot). */
  extensions: readonly string[];
  /**
   * True when the file has to start with a UTF-8 BOM. Excel reads a CSV
   * without one as the system code page and mangles every non-ASCII line.
   */
  bom: boolean;
};

export const TRANSLATION_EXCHANGE_FORMAT_INFO: Record<
  TranslationExchangeFormat,
  TranslationExchangeFormatInfo
> = {
  csv: { extension: "csv", extensions: ["csv"], bom: true },
  xliff: { extension: "xlf", extensions: ["xlf", "xliff"], bom: false },
  po: { extension: "po", extensions: ["po", "pot"], bom: false },
  json: { extension: "json", extensions: ["json"], bom: false }
};

/** Every extension the import dialog accepts, in format order. */
export function translationExchangeExtensions(): string[] {
  return TRANSLATION_EXCHANGE_FORMATS.flatMap((format) => [
    ...TRANSLATION_EXCHANGE_FORMAT_INFO[format].extensions
  ]);
}

/** Serialize rows into one exchange file, BOM included where the format needs it. */
export function serializeTranslationExchange(
  format: TranslationExchangeFormat,
  document: TranslationExchangeDocument
): string {
  const body = serializeBody(format, document);
  return TRANSLATION_EXCHANGE_FORMAT_INFO[format].bom ? `﻿${body}` : body;
}

function serializeBody(
  format: TranslationExchangeFormat,
  document: TranslationExchangeDocument
): string {
  switch (format) {
    case "csv":
      return serializeTranslationCsv(document.rows);
    case "xliff":
      return serializeTranslationXliff(document);
    case "po":
      return serializeTranslationPo(document);
    case "json":
      return serializeTranslationJson(document);
  }
}

/** Read one exchange file. Never throws: a file Studio cannot read reports errors and no rows. */
export function parseTranslationExchange(
  format: TranslationExchangeFormat,
  text: string
): ParsedTranslationExchange {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  switch (format) {
    case "csv":
      return parseTranslationCsv(clean);
    case "xliff":
      return parseTranslationXliff(clean);
    case "po":
      return parseTranslationPo(clean);
    case "json":
      return parseTranslationJson(clean);
  }
}

/**
 * Which format a file is, by extension first and by content second.
 *
 * Content sniffing is not a nicety: a translator who mails back
 * `translations.txt` or a CAT tool that writes `.xliff.xml` would otherwise be
 * told their file is unsupported while it sits there perfectly readable.
 */
export function detectTranslationExchangeFormat(
  fileName: string,
  text?: string
): TranslationExchangeFormat | null {
  const extension = fileName.toLowerCase().split(/[\\/]/).pop()?.split(".").pop() ?? "";
  for (const format of TRANSLATION_EXCHANGE_FORMATS) {
    if (TRANSLATION_EXCHANGE_FORMAT_INFO[format].extensions.includes(extension)) {
      return format;
    }
  }
  if (text === undefined) {
    return null;
  }
  const head = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trimStart();
  if (head.startsWith("{") || head.startsWith("[")) {
    return "json";
  }
  if (head.startsWith("<?xml") || head.startsWith("<xliff") || head.includes("<trans-unit")) {
    return "xliff";
  }
  if (/^(#[.:,~|]?\s|msgid\s|msgctxt\s)/m.test(head)) {
    return "po";
  }
  if (/^[^\r\n]*\bunit_id\b/i.test(head)) {
    return "csv";
  }
  return null;
}
