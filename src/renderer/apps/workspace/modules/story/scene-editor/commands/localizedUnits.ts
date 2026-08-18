import { SOURCE_LOCALE, type TranslationKey } from "@shared/i18n";
import { commandI18nStore, translateCommand } from "@/lib/i18n";
import {
  numberValueOf,
  paramTypes,
  type StoryCommandParam,
  type StoryCommandParamType
} from "../storyCommandGrammar";

/**
 * The localized spelling of a unit: the table that lets an author who reads `持续时间=1秒` type it.
 *
 * The fourth of four, after commands, param keys and enum values — and it exists for the same reason
 * they do. The committed row prints the unit (it is what makes `持续时间=1` read as a time rather than
 * as a count), and a row may only show a line the author could have typed. Showing `秒` while the
 * parser took only `s` would be the same broken promise the other three tables were built to end.
 *
 * **Additive, never a shadow.** Same drop rules as its siblings — an entry is dropped when its folded
 * label is blank, echoes its key (untranslated), contains whitespace, or already spells the canonical
 * unit — plus one of its own: a spelling that could be read as part of the NUMBER (it starts with a
 * digit, a sign or a dot) is refused, since `1e` would then be two readings of one string. So `d=1s`
 * parses identically in every command language and only a genuinely translated word is added.
 *
 * Unlike the other three this table is keyed by the canonical unit alone: a unit means one thing
 * wherever it appears (a second is a second on `d=`, `fade=` and `/wait` alike), so there is no
 * per-def or per-option-set collision to guard against.
 */

type LocalizedUnitCache = {
  locale: string;
  /** Canonical unit → this locale's spelling. Only units that earned one. */
  spelling: ReadonlyMap<string, string>;
};

let cache: LocalizedUnitCache | null = null;
commandI18nStore.subscribe(() => {
  cache = null;
});

/** A spelling that could be mistaken for part of the number it follows is not a unit. */
function isReadableSuffix(label: string): boolean {
  return label !== "" && !/\s/.test(label) && !/^[-+.\d]/.test(label);
}

function spellingFor(unit: string): string | null {
  const locale = commandI18nStore.getLocale();
  // The source locale writes the canonical unit, always — the English catalog entry IS that unit,
  // so anything else here would be the catalog second-guessing the grammar (the guard every one of
  // these tables carries; see `localizedParamKey`).
  if (locale === SOURCE_LOCALE) {
    return null;
  }
  if (cache?.locale !== locale) {
    cache = { locale, spelling: new Map() };
  }
  const found = cache.spelling.get(unit);
  if (found !== undefined) {
    return found === "" ? null : found;
  }
  const key = `story.unit.${unit}` as TranslationKey;
  const raw = translateCommand(key).trim();
  const usable = raw !== key && raw.toLowerCase() !== unit.toLowerCase() && isReadableSuffix(raw);
  (cache.spelling as Map<string, string>).set(unit, usable ? raw : "");
  return usable ? raw : null;
}

/** How this unit is written in the command language — the localized word, else the canonical one. */
export function localizedUnit(unit: string): string {
  return spellingFor(unit) ?? unit;
}

/** Every spelling of this unit the parser accepts, longest first so `秒` never shadows a longer word. */
function spellings(unit: string): readonly string[] {
  const localized = spellingFor(unit);
  return localized ? [localized, unit] : [unit];
}

/**
 * How many trailing characters of `value` are this param's unit, or 0.
 *
 * The one answer both the parser (which must ignore it) and the colouring (which must mute it) read,
 * so a line can never be accepted with a suffix that then reads as part of the value.
 */
export function unitSuffixLength(param: StoryCommandParam | null, value: string): number {
  if (param === null) {
    return 0;
  }
  const trimmed = value.trim();
  for (const type of paramTypes(param)) {
    if (type.kind !== "number" || !type.unit) {
      continue;
    }
    for (const spelling of spellings(type.unit)) {
      const body = trimmed.slice(0, -spelling.length);
      if (
        trimmed.toLowerCase().endsWith(spelling.toLowerCase()) &&
        body !== "" &&
        Number.isFinite(Number(body))
      ) {
        return spelling.length;
      }
    }
  }
  return 0;
}

/**
 * The number a value spells, in any spelling of its unit this locale accepts.
 *
 * Use this everywhere {@link numberValueOf} was used from the command pipeline; the bare
 * `numberValueOf` stays the pure, locale-free reader, exactly as `matchEnumOption` does for enums.
 */
export function numberValueOfLocalized(
  type: Extract<StoryCommandParamType, { kind: "number" }>,
  raw: string
): number | null {
  const direct = numberValueOf(type, raw);
  if (direct !== null || !type.unit) {
    return direct;
  }
  const localized = spellingFor(type.unit);
  if (!localized) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.toLowerCase().endsWith(localized.toLowerCase())
    ? numberValueOf({ ...type, unit: localized }, trimmed)
    : null;
}
