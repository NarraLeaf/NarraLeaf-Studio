import type { LocaleCode } from "@shared/types/localization";
import type { VoiceUnit, VoiceUnitStatus } from "@shared/types/voice";

/**
 * The takes of copied story rows, following them to the ids the paste minted.
 *
 * A `textId` is one identity worn by three things: the translation unit, the voice unit, and part of
 * the save anchor. A paste mints a fresh one for every row it writes, so until this existed a line
 * that moved lost its recording: the voice table put it back to `missing`, the imported audio became
 * an orphan nothing pointed at, and no surface said a word about either. Restructuring a script -
 * splitting a scene that ran long, moving a section into the next chapter - is ordinary work, and
 * there is no operation that moves rows between scenes, so the way it is done is copy and paste.
 *
 * The shape mirrors `storyTranslationTransfer`, and three things differ:
 *
 *  - **Nothing travels on the clipboard.** A take is an `assetId` into THIS project's audio library,
 *    and Studio carries no audio with the rows: the transfer offer is minted for the files the rows
 *    themselves name, and a take's clip is not one of them. An id that means nothing over there is
 *    worth nothing over there, so takes are read live out of the voice libraries at paste time,
 *    under the ids the rows had before the paste renamed them. Rows pasted into another project
 *    therefore arrive unvoiced, which is the only thing they could honestly arrive as.
 *  - **The libraries are opened first.** A copy is a synchronous event and cannot wait for a file,
 *    which is why the translations are read from whatever happens to be in memory. This runs after
 *    the rows are already in the scene, so it can open every voiced language properly - a language
 *    whose file nobody had looked at yet still carries its takes across.
 *  - **`sourceHash` and `status` are carried verbatim, `approved` included.** A translation review is
 *    withheld because the paste creates a unit nobody has read. A take is not created by the paste:
 *    both rows point at the same recording, of the same text, and a director signing it off said
 *    that recording is an acceptable performance of that line - which is still true. Sending it back
 *    to the queue would cost a re-listen of a file that has not changed, and would tell whoever
 *    listened nothing. Re-stamping the hash is refused for the reason it is refused there: a take
 *    recorded against a line that has since been rewritten is out of date, and a paste that
 *    re-anchored it would quietly say it was current.
 *
 * Ordered after the translations by the callers, because a take is a recording of the line as the
 * actor for that language reads it - the translation, where the project has one (see
 * `voiceLineText`). A take that landed first would read as stale until its translation caught up.
 *
 * The takes are not part of the paste's undo step and cannot be, exactly as the translations are
 * not: the scene's history scope captures the scene document, and takes live in per-language
 * documents another service owns. Undoing a paste leaves them behind keyed by ids no row uses any
 * more, which is the same orphan state deleting a voiced row already produces, and what
 * `voice/orphan` reports.
 */

/** One voice language's share of a carried set. */
export type CarriedVoiceWrite = {
    locale: LocaleCode;
    units: Record<string, VoiceUnit>;
};

export type CarriedVoicePlan = {
    /** What to write, per voice language, in configuration order. */
    writes: CarriedVoiceWrite[];
    /** Takes that will be written. */
    carried: number;
};

export type CarriedVoiceOutcome = {
    /** Takes written. */
    written: number;
    /**
     * The workspace froze part-way through.
     *
     * Nothing further is written. What did land is in memory and is refused at the file-system
     * boundary like every other write made while frozen, so the thaw's re-read is what decides.
     */
    frozen: boolean;
};

/** Takes for the lines being copied, per voice language, keyed by the ids those lines have now. */
export type CarriedVoiceTakes = Record<LocaleCode, Record<string, VoiceUnit>>;

/**
 * What every voice language of this project holds for the given lines.
 *
 * Only lines with a take: a unit with no clip is what an unvoiced line already looks like
 * everywhere. Undefined - rather than an empty table - when nothing at all is voiced, so the callers
 * can stop before opening anything.
 */
export function collectVoiceTakes(
    textIds: readonly string[],
    locales: readonly LocaleCode[],
    unitsFor: (locale: LocaleCode) => Readonly<Record<string, VoiceUnit>> | undefined,
): CarriedVoiceTakes | undefined {
    const takes: CarriedVoiceTakes = {};
    let any = false;
    for (const locale of locales) {
        const units = unitsFor(locale);
        if (!units) {
            continue;
        }
        const carried: Record<string, VoiceUnit> = {};
        let carriedAny = false;
        for (const textId of textIds) {
            const unit = units[textId];
            if (unit?.assetId) {
                carried[textId] = unit;
                carriedAny = true;
            }
        }
        if (carriedAny) {
            takes[locale] = carried;
            any = true;
        }
    }
    return any ? takes : undefined;
}

/**
 * Work out what to write, given the renaming the paste has just performed.
 *
 * `textIds` is that renaming, old id → new id, as `cloneSerializedBlock` collected it. A take whose
 * id is not in it belongs to a line this paste did not write and is dropped: only the ids the rows
 * actually brought have anywhere to land.
 */
export function planCarriedVoice(
    carried: CarriedVoiceTakes | undefined,
    textIds: ReadonlyMap<string, string>,
): CarriedVoicePlan {
    const plan: CarriedVoicePlan = { writes: [], carried: 0 };
    if (!carried || textIds.size === 0) {
        return plan;
    }
    for (const [locale, units] of Object.entries(carried)) {
        const written: Record<string, VoiceUnit> = {};
        let count = 0;
        for (const [sourceTextId, unit] of Object.entries(units)) {
            const textId = textIds.get(sourceTextId);
            if (!textId) {
                continue;
            }
            written[textId] = carriedTake(unit);
            count += 1;
        }
        if (count > 0) {
            plan.writes.push({ locale, units: written });
            plan.carried += count;
        }
    }
    return plan;
}

/**
 * What carrying takes needs of the workspace around it.
 *
 * Stated as functions rather than taken as a service, like the translation port, so the order the
 * write has to keep - open a language's library, write into it, and stop the moment the workspace
 * freezes - can be exercised without a project behind it.
 */
export interface CarriedVoicePort {
    /** Make a voice language's library readable and writable. False when it could not be opened. */
    open(locale: LocaleCode): Promise<boolean>;
    /** File the takes under the ids they are keyed by. False when they could not be written. */
    adopt(locale: LocaleCode, units: Record<string, VoiceUnit>): boolean;
    /** Whether this window's project data has frozen. Asked again after every await. */
    isFrozen(): boolean;
}

/**
 * Read in the voice libraries of the given languages, and report which ones answered.
 *
 * A language whose library cannot be read costs the author that language and nothing else: the rows
 * are already in the scene by the time this runs, and a paste is worth more than the recording it
 * could not bring with it.
 */
export async function openVoiceLibraries(
    port: CarriedVoicePort,
    locales: readonly LocaleCode[],
): Promise<{ opened: LocaleCode[]; frozen: boolean }> {
    const opened: LocaleCode[] = [];
    for (const locale of locales) {
        const ok = await port.open(locale);
        if (port.isFrozen()) {
            return { opened, frozen: true };
        }
        if (ok) {
            opened.push(locale);
        }
    }
    return { opened, frozen: false };
}

/**
 * Write a plan's takes, one language at a time.
 *
 * Synchronous, unlike the translation writer: every library it writes into was opened by
 * {@link openVoiceLibraries} before the takes were read out of them, so there is nothing left to
 * wait for and no second window in which a freeze could land unseen.
 */
export function writeCarriedVoice(port: CarriedVoicePort, plan: CarriedVoicePlan): CarriedVoiceOutcome {
    const outcome: CarriedVoiceOutcome = { written: 0, frozen: false };
    for (const write of plan.writes) {
        if (port.isFrozen()) {
            return { ...outcome, frozen: true };
        }
        const count = Object.keys(write.units).length;
        if (count === 0 || !port.adopt(write.locale, write.units)) {
            continue;
        }
        outcome.written += count;
    }
    return outcome;
}

/**
 * The slice of the voice service these transfers need.
 *
 * Structural rather than the service type, so this module stays free of the workspace and can be
 * tested with a plain object.
 */
export interface VoiceDocuments {
    getConfiguration(): { voicedLocales: readonly { code: LocaleCode }[] };
    getDocumentIfLoaded(locale: LocaleCode): { units?: Readonly<Record<string, VoiceUnit>> } | undefined;
    loadDocument(locale: LocaleCode): Promise<unknown>;
    adoptUnits(locale: LocaleCode, units: Record<string, VoiceUnit>): void;
}

/** The languages this project dubs into, or none while its configuration is still unreadable. */
export function readVoicedLocales(documents: VoiceDocuments): LocaleCode[] {
    try {
        return documents.getConfiguration().voicedLocales.map(entry => entry.code);
    } catch {
        // The project configuration is not readable yet. Pasting rows does not wait for it.
        return [];
    }
}

/**
 * The workspace, as {@link writeCarriedVoice} asks about it.
 *
 * Every method answers rather than throws, like the translation port: a language that cannot be
 * opened or written costs the author that language, and the rows are already in the scene.
 */
export function createCarriedVoicePort(
    documents: VoiceDocuments,
    isFrozen: () => boolean,
): CarriedVoicePort {
    return {
        open: async (locale: LocaleCode) => {
            try {
                await documents.loadDocument(locale);
                return true;
            } catch (error) {
                console.warn(`[storyVoice] could not open the voice library for "${locale}"`, error);
                return false;
            }
        },
        adopt: (locale, units) => {
            try {
                documents.adoptUnits(locale, units);
                return true;
            } catch (error) {
                console.warn(`[storyVoice] could not carry the takes for "${locale}"`, error);
                return false;
            }
        },
        isFrozen,
    };
}

/**
 * Carry the takes of rows copied WITHIN one project - what pasting rows into another scene, and
 * duplicating them where they are, both need.
 *
 * `oldTextIds` are the ids the lines had before the paste renamed them, and `textIdMap` is that
 * renaming. Both come from the paste itself, so nothing here has to trust a payload: a take is only
 * ever read out of, and written back into, the project the author is looking at.
 */
export async function carryVoiceWithinProject(
    documents: VoiceDocuments,
    isFrozen: () => boolean,
    oldTextIds: readonly string[],
    textIdMap: ReadonlyMap<string, string>,
): Promise<CarriedVoiceOutcome> {
    if (oldTextIds.length === 0 || textIdMap.size === 0) {
        return { written: 0, frozen: false };
    }
    const locales = readVoicedLocales(documents);
    if (locales.length === 0) {
        return { written: 0, frozen: false };
    }
    const port = createCarriedVoicePort(documents, isFrozen);
    const { opened, frozen } = await openVoiceLibraries(port, locales);
    if (frozen) {
        return { written: 0, frozen: true };
    }
    const carried = collectVoiceTakes(
        oldTextIds,
        opened,
        locale => documents.getDocumentIfLoaded(locale)?.units,
    );
    const plan = planCarriedVoice(carried, textIdMap);
    if (plan.carried === 0) {
        return { written: 0, frozen: false };
    }
    return writeCarriedVoice(port, plan);
}

/**
 * One take, as it lands on the new line.
 *
 * Field by field so a stored unit that has grown something this transfer does not understand cannot
 * ride along unexamined, and so the two fields that decide what the voice table says about the line
 * - the anchor and the sign-off - are visibly the ones that carry unchanged.
 */
function carriedTake(unit: VoiceUnit): VoiceUnit {
    const status: VoiceUnitStatus = unit.status === "approved" ? "approved" : "linked";
    return {
        assetId: unit.assetId,
        sourceHash: unit.sourceHash,
        status,
        ...(typeof unit.duration === "number" && Number.isFinite(unit.duration) ? { duration: unit.duration } : {}),
        ...(unit.note ? { note: unit.note } : {}),
    };
}
