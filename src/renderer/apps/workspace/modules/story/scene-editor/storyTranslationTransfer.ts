import type { LocaleCode, LocalizationUnit, LocalizationUnitStatus } from "@shared/types/localization";
import { isValidLocaleCode } from "@shared/types/localization";
import type { StoryClipboardTranslations } from "./storySceneEditorTypes";

/**
 * The translations of copied story rows, travelling with them.
 *
 * A translation unit is keyed by the `textId` of the line it translates, and a paste mints a fresh
 * `textId` for every row it writes - it has to, or two rows would share one unit and a language
 * would have no way to say different things about them. The consequence, until this existed, was
 * that copying a translated line produced an untranslated one, silently, and within a single
 * project as much as between two: duplicating a finished chapter threw away every language it had.
 *
 * So the units travel on the clipboard beside the rows, and the paste writes them back under the
 * ids it has just minted. Three decisions shape that:
 *
 *  - **Whole units, `sourceHash` and note included.** The line arrives character for character, so
 *    everything the unit said about itself over there is still true here - including a stale anchor,
 *    which says the translation was made against a source line that has since been rewritten. A
 *    paste that re-anchored it would turn a translation known to be out of date into a current one.
 *  - **A review is not inherited.** `reviewed` says a person signed off on that unit; nobody has
 *    signed off on the one the paste creates, so it lands as `translated`. `machine` is a statement
 *    about where the text came from rather than about who approved it, and stays. Understating what
 *    a translation has been through costs a second look; overstating it costs the review.
 *  - **Only languages the pasting project declares.** A unit for a language this project does not
 *    have has nowhere to go, and adding a language is a decision an author makes rather than
 *    something a paste does behind them - so those are counted and reported, never written.
 *
 * The units are not part of the paste's undo step and cannot be: the scene's history scope captures
 * the scene document, and translations live in per-locale documents another service owns. Undoing a
 * paste therefore leaves the carried units behind, keyed by `textId`s no row uses any more - which
 * is the same orphan state deleting a translated row already produces, and what
 * `localization/orphan` reports.
 */

/**
 * What every language of this project says about the given lines, for the clipboard.
 *
 * Only lines that are actually translated: a unit with no target is what an untranslated line
 * already looks like everywhere, so carrying one would move nothing and describe the project doing
 * it. Undefined - rather than an empty table - when nothing at all is translated, so the payload
 * simply has no such field.
 */
export function collectClipboardTranslations(
    textIds: readonly string[],
    locales: readonly LocaleCode[],
    unitsFor: (locale: LocaleCode) => Readonly<Record<string, LocalizationUnit>> | undefined,
): StoryClipboardTranslations | undefined {
    const translations: StoryClipboardTranslations = {};
    let any = false;
    for (const locale of locales) {
        const units = unitsFor(locale);
        if (!units) {
            continue;
        }
        const carried: Record<string, LocalizationUnit> = {};
        let carriedAny = false;
        for (const textId of textIds) {
            const unit = units[textId];
            if (unit?.target) {
                carried[textId] = unit;
                carriedAny = true;
            }
        }
        if (carriedAny) {
            translations[locale] = carried;
            any = true;
        }
    }
    return any ? translations : undefined;
}

/** One language's share of a carried set, re-keyed onto the ids the paste minted. */
export type CarriedTranslationWrite = {
    locale: LocaleCode;
    units: Record<string, LocalizationUnit>;
};

export type CarriedTranslationPlan = {
    /** What to write, per language, in the order the payload named them. */
    writes: CarriedTranslationWrite[];
    /** Translations that will be written. */
    carried: number;
    /** Translations left behind because this project does not have their language. */
    droppedLocales: number;
};

/**
 * Work out what a paste can do with the translations it was handed.
 *
 * `textIds` is the renaming the paste has just performed, old id → new id, as
 * `cloneSerializedBlock` collected it. A unit whose id is not in it translates a line this paste did
 * not write and is dropped without comment: an id-keyed table arriving from another process says
 * whatever it likes, and only the ids the rows actually brought have anywhere to land.
 *
 * Everything here is rebuilt field by field rather than trusted, for the reason the character names
 * and the asset manifest are - the payload was written by another Studio, of another version, and
 * one value of the wrong type would otherwise be written into a translation file.
 */
export function planCarriedTranslations(
    carried: unknown,
    textIds: ReadonlyMap<string, string>,
    knownLocales: ReadonlySet<LocaleCode>,
): CarriedTranslationPlan {
    if (!carried || typeof carried !== "object" || textIds.size === 0) {
        return { writes: [], carried: 0, droppedLocales: 0 };
    }
    const plan: CarriedTranslationPlan = { writes: [], carried: 0, droppedLocales: 0 };
    for (const [locale, value] of Object.entries(carried as Record<string, unknown>)) {
        // A key that is not a language code at all names nothing, here or anywhere, and is not
        // something to report as a missing language.
        if (!isValidLocaleCode(locale) || !value || typeof value !== "object") {
            continue;
        }
        const known = knownLocales.has(locale);
        const units: Record<string, LocalizationUnit> = {};
        let count = 0;
        for (const [sourceTextId, raw] of Object.entries(value as Record<string, unknown>)) {
            const textId = textIds.get(sourceTextId);
            if (!textId) {
                continue;
            }
            const unit = readCarriedUnit(raw);
            if (!unit) {
                continue;
            }
            count += 1;
            if (known) {
                units[textId] = unit;
            }
        }
        if (!known) {
            plan.droppedLocales += count;
            continue;
        }
        if (count > 0) {
            plan.writes.push({ locale, units });
            plan.carried += count;
        }
    }
    return plan;
}

/**
 * What writing carried translations needs of the workspace around it.
 *
 * Stated as functions rather than taken as a service so the order the write has to keep - open the
 * language's document, write into it, and stop the moment the workspace freezes - can be exercised
 * without a project behind it.
 */
export interface CarriedTranslationPort {
    /** Make a language's document readable and writable. False when it could not be opened. */
    open(locale: LocaleCode): Promise<boolean>;
    /** File the units under the ids they are keyed by. False when they could not be written. */
    adopt(locale: LocaleCode, units: Record<string, LocalizationUnit>): boolean;
    /** Whether this window's project data has frozen. Asked again after every await. */
    isFrozen(): boolean;
}

export type CarriedTranslationOutcome = {
    /** Translations written. */
    written: number;
    /**
     * The workspace froze part-way through.
     *
     * Nothing further is written. What did land is in memory and is refused at the file-system
     * boundary like every other write made while frozen, so the thaw's re-read is what decides.
     */
    frozen: boolean;
};

/**
 * Write a plan's translations, one language at a time.
 *
 * A language whose document cannot be opened costs the author that language and nothing else: the
 * rows are already in the scene by the time this runs, and a paste is worth more than the
 * translation it could not bring with it.
 */
export async function writeCarriedTranslations(
    port: CarriedTranslationPort,
    plan: CarriedTranslationPlan,
): Promise<CarriedTranslationOutcome> {
    const outcome: CarriedTranslationOutcome = { written: 0, frozen: false };
    for (const write of plan.writes) {
        const opened = await port.open(write.locale);
        if (port.isFrozen()) {
            return { ...outcome, frozen: true };
        }
        if (!opened) {
            continue;
        }
        const count = Object.keys(write.units).length;
        if (count === 0 || !port.adopt(write.locale, write.units)) {
            continue;
        }
        outcome.written += count;
    }
    return outcome;
}

/** One carried unit, rebuilt from whatever arrived, or null when it holds no translation. */
function readCarriedUnit(value: unknown): LocalizationUnit | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    const target = typeof record.target === "string" ? record.target : "";
    if (!target) {
        return null;
    }
    const note = typeof record.note === "string" && record.note ? record.note : undefined;
    return {
        target,
        sourceHash: typeof record.sourceHash === "string" ? record.sourceHash : "",
        status: adoptedStatus(record.status),
        ...(note ? { note } : {}),
    };
}

/**
 * The status a carried translation lands with.
 *
 * `machine` is kept because it describes the text itself. Everything else becomes `translated`:
 * `reviewed` would claim a sign-off nobody has given this unit, and a unit that arrives with a
 * target but calls itself untranslated is already read as translated everywhere (see
 * `deriveUnitState`), so storing it as such only says out loud what is already true.
 */
function adoptedStatus(value: unknown): LocalizationUnitStatus {
    return value === "machine" ? "machine" : "translated";
}

/**
 * The slice of the localization service these transfers need.
 *
 * Structural rather than the service type, so this module stays free of the workspace and can be
 * tested with a plain object.
 */
export interface TranslationDocuments {
    getConfiguration(): { locales: readonly { code: LocaleCode }[] };
    getDocumentIfLoaded(locale: LocaleCode): { units?: Readonly<Record<string, LocalizationUnit>> } | undefined;
    loadDocument(locale: LocaleCode): Promise<unknown>;
    adoptUnits(locale: LocaleCode, units: Record<string, LocalizationUnit>): void;
}

/** The languages this project declares, or none while its configuration is still unreadable. */
export function readProjectLocales(documents: TranslationDocuments): LocaleCode[] {
    try {
        return documents.getConfiguration().locales.map(entry => entry.code);
    } catch {
        // The project configuration is not readable yet. Copying rows does not wait for it.
        return [];
    }
}

/**
 * The workspace, as {@link writeCarriedTranslations} asks about it.
 *
 * Every method answers rather than throws, like the asset port: a language that cannot be opened or
 * written costs the author that language, and the rows are already in the scene.
 */
export function createCarriedTranslationPort(
    documents: TranslationDocuments,
    isFrozen: () => boolean,
): CarriedTranslationPort {
    return {
        open: async (locale: LocaleCode) => {
            try {
                await documents.loadDocument(locale);
                return true;
            } catch (error) {
                console.warn(`[storyTranslations] could not open the translations for "${locale}"`, error);
                return false;
            }
        },
        adopt: (locale, units) => {
            try {
                documents.adoptUnits(locale, units);
                return true;
            } catch (error) {
                console.warn(`[storyTranslations] could not carry the translations for "${locale}"`, error);
                return false;
            }
        },
        isFrozen,
    };
}

/**
 * Carry the translations of rows being copied WITHIN one project - what duplicating rows needs.
 *
 * The clipboard route exists because a payload has to survive leaving the process; duplicating does
 * not, so this reads the same documents it writes. It still goes through the same collect/plan/write
 * so that a duplicated row and a pasted one end up saying the same thing about their translations -
 * an author who finds Ctrl+D and Ctrl+V disagreeing about this has no way to tell which is right.
 *
 * Languages cannot be dropped here: the project being read is the project being written.
 */
export async function carryTranslationsWithinProject(
    documents: TranslationDocuments,
    isFrozen: () => boolean,
    oldTextIds: readonly string[],
    textIdMap: ReadonlyMap<string, string>,
): Promise<CarriedTranslationOutcome> {
    if (oldTextIds.length === 0 || textIdMap.size === 0) {
        return { written: 0, frozen: false };
    }
    const locales = readProjectLocales(documents);
    const carried = collectClipboardTranslations(
        oldTextIds,
        locales,
        locale => documents.getDocumentIfLoaded(locale)?.units,
    );
    if (!carried) {
        return { written: 0, frozen: false };
    }
    const plan = planCarriedTranslations(carried, textIdMap, new Set(locales));
    if (plan.carried === 0) {
        return { written: 0, frozen: false };
    }
    return writeCarriedTranslations(createCarriedTranslationPort(documents, isFrozen), plan);
}
