import type { LiveDerived } from "@shared/live/ops";
import { isValidLocaleCode, type LocalizationUnit } from "@shared/types/localization";
import type { VoiceUnit } from "@shared/types/voice";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { getProjectWriteFreeze, holdDerivedProjectWrites } from "@/lib/app/writeFreeze";
import { isStoryPasteFromAnotherProject } from "./storyForeignPaste";
import type { StoryClipboardPayload } from "./storySceneEditorTypes";
import {
    writeCarriedTranslations,
    type CarriedTranslationPlan,
    type CarriedTranslationPort,
} from "./storyTranslationTransfer";
import {
    openVoiceLibraries,
    writeCarriedVoice,
    type CarriedVoicePlan,
    type CarriedVoicePort,
} from "./storyVoiceTransfer";

/**
 * Pasting story rows while a live session is open on the project.
 *
 * A paste is two different things, and one question separates them: **can everybody else in the
 * session compute the same result from the same broadcast effect?**
 *
 *  - Rows copied out of this project and pasted back into it can. Their translations and takes
 *    follow them exactly as they always have, and that is not an edit of the localization library -
 *    it is a *derivation*, performed identically on every machine from one effect. Which is why the
 *    entries travel in {@link LiveDerived} rather than as ids to look up: the copier read them out
 *    of its own memory at the moment of copying, and nobody else has that memory. An effect saying
 *    "find this text id in your own library" would derive nothing anywhere.
 *  - Rows from another project, or another Studio, cannot. Their translations, takes and asset bytes
 *    exist only on the machine holding the clipboard, so no effect can carry the room to the same
 *    result. Those rows land on their own, and the author is told once.
 *
 * The rows that land from outside carry asset references that resolve to nothing. That is not
 * silent and needs no second warning here: `assets/missing` reports every site, with a jump to the
 * row, and refuses a build.
 */

/** Where a clipboard payload's rows were written. */
export type StoryPasteOrigin =
    /** This project wrote them, so everything they carry can be derived from one effect. */
    | "own"
    /** Another project, or another Studio, wrote them. */
    | "outside";

/**
 * Which of the two a paste is - the single test, asked in one place.
 *
 * It is the project's identity and nothing else, because that is exactly what decides whether the
 * rest of the room can reproduce what this paste writes. Everything that follows from the answer -
 * what an effect carries, what is stripped, what the author is told - hangs off this one call, so
 * the two paths cannot end up disagreeing about which one a paste took.
 *
 * Note the case that looks like a third: rows copied out of this project *while a session is
 * running* and pasted back into it are `own`, because the session changes nothing about where they
 * came from. `outside` is about the bytes' origin, never about when the copy happened.
 */
export function classifyStoryPaste(payload: StoryClipboardPayload, projectPath: string): StoryPasteOrigin {
    return isStoryPasteFromAnotherProject(payload, projectPath) ? "outside" : "own";
}

/**
 * The room a live session has this project frozen for, or null when no session is open on it.
 *
 * The freeze is the only thing that knows: a session arms a `live-session` freeze over the project
 * and leaves its story document writable, so the freeze's own record is where the room's id lives.
 * Read at the moment it is asked rather than captured, because a paste is a gesture and a session
 * can open or close between two of them.
 *
 * The project is compared because the latch is module-level while a freeze belongs to one project;
 * a freeze naming another one says nothing about this paste.
 */
export function liveSessionOnProject(projectPath: string): string | null {
    const freeze = getProjectWriteFreeze();
    if (!freeze || freeze.reason.kind !== "live-session") {
        return null;
    }
    return normalizeProjectPath(freeze.projectPath) === normalizeProjectPath(projectPath)
        ? freeze.reason.session
        : null;
}

/**
 * Whether a derived write is refused right now, as the transfer ports ask it.
 *
 * The interface half of the window {@link holdDerivedProjectWrites} opens. A session freezes
 * everything but its own story document, so the ordinary "is anything frozen" answer is `true` for
 * the whole session and would stop a derived write before it put down a byte - while the write
 * boundary, which knows about the window, would have allowed it. Every other freeze still refuses:
 * a revision, a merge and recovery derive nothing from anything.
 */
export function derivedWritesFrozen(projectPath: string): boolean {
    return getProjectWriteFreeze() !== null && liveSessionOnProject(projectPath) === null;
}

/**
 * The payload as rows and nothing else.
 *
 * The two fields a clipboard payload can carry beyond the rows are the two that only exist on the
 * machine holding it: a grant reaching another project's files, and that project's translations.
 * Both are dropped *before* the rows are treated, so what a rows-only paste may write is a property
 * of the value it works from rather than a promise every later step has to remember to keep.
 *
 * Takes are not stripped because they were never here: a take is an id into the *recording*
 * project's audio library, so it is worth nothing anywhere else and no copy has ever put one on the
 * clipboard. What keeps them out is that this path reads no voice library at all.
 */
export function rowsOnlyPayload(payload: StoryClipboardPayload): StoryClipboardPayload {
    const { assets: _assets, translations: _translations, ...rows } = payload;
    return rows;
}

/**
 * The entries a paste derives, keyed by the ids it has just minted - what one effect carries.
 *
 * Built from the plans the paste already computed, so what travels and what is written locally can
 * never be two different sets. Undefined when there is nothing to carry, which is the ordinary case
 * for a project that is neither translated nor dubbed.
 */
export function liveDerivedFor(
    translations: CarriedTranslationPlan,
    voice: CarriedVoicePlan,
): LiveDerived | undefined {
    const carriedTranslations: Record<string, Record<string, LocalizationUnit>> = {};
    for (const write of translations.writes) {
        const entries: Record<string, LocalizationUnit> = {};
        for (const [textId, unit] of Object.entries(write.units)) {
            if (unit.target) {
                entries[textId] = unit;
            }
        }
        if (Object.keys(entries).length > 0) {
            carriedTranslations[write.locale] = entries;
        }
    }

    const carriedVoice: Record<string, Record<string, VoiceUnit>> = {};
    for (const write of voice.writes) {
        const entries: Record<string, VoiceUnit> = {};
        for (const [textId, unit] of Object.entries(write.units)) {
            if (unit.assetId) {
                entries[textId] = unit;
            }
        }
        if (Object.keys(entries).length > 0) {
            carriedVoice[write.locale] = entries;
        }
    }

    const derived: LiveDerived = {
        ...(Object.keys(carriedTranslations).length > 0 ? { translations: carriedTranslations } : {}),
        ...(Object.keys(carriedVoice).length > 0 ? { voice: carriedVoice } : {}),
    };
    return derived.translations || derived.voice ? derived : undefined;
}

/**
 * What an effect's entries become in this project's libraries.
 *
 * Rebuilt field by field rather than trusted, for the reason the clipboard's own table is: the
 * message was written by another Studio, of another version, and one value of the wrong type would
 * otherwise be written into a translation file.
 *
 * The whole unit travels, so what lands here is what the copier had: the same source hash, the same
 * status, the same note. Rebuilding a unit from its text alone would leave every carried line with
 * no hash - which the reader derives as stale - and with its review discarded, so pasting inside a
 * session would quietly demote work that pasting outside one keeps, and nobody would see it until
 * somebody re-read a language.
 *
 * No language is dropped and none is checked against the project's configuration. Every machine in
 * a session opened on one committed revision of one project, so the languages are the same
 * everywhere - and a filter applied on one machine and not another is precisely the divergence
 * these entries exist to prevent.
 */
export function planLiveDerived(derived: LiveDerived): {
    translations: CarriedTranslationPlan;
    voice: CarriedVoicePlan;
} {
    const translations: CarriedTranslationPlan = { writes: [], carried: 0, droppedLocales: 0 };
    for (const [locale, entries] of Object.entries(derived.translations ?? {})) {
        if (!isValidLocaleCode(locale) || !entries || typeof entries !== "object") {
            continue;
        }
        const units: Record<string, LocalizationUnit> = {};
        let count = 0;
        for (const [textId, unit] of Object.entries(entries as Record<string, unknown>)) {
            const read = readLocalizationUnit(unit);
            if (!textId || !read) {
                continue;
            }
            units[textId] = read;
            count += 1;
        }
        if (count > 0) {
            translations.writes.push({ locale, units });
            translations.carried += count;
        }
    }

    const voice: CarriedVoicePlan = { writes: [], carried: 0 };
    for (const [locale, entries] of Object.entries(derived.voice ?? {})) {
        if (!isValidLocaleCode(locale) || !entries || typeof entries !== "object") {
            continue;
        }
        const units: Record<string, VoiceUnit> = {};
        let count = 0;
        for (const [textId, unit] of Object.entries(entries as Record<string, unknown>)) {
            const read = readVoiceUnit(unit);
            if (!textId || !read) {
                continue;
            }
            units[textId] = read;
            count += 1;
        }
        if (count > 0) {
            voice.writes.push({ locale, units });
            voice.carried += count;
        }
    }

    return { translations, voice };
}

/**
 * One translation unit off the wire, or null when it is not one.
 *
 * Field by field rather than trusted, and the reason is the same one the clipboard's own table
 * gives: this arrived from another Studio, of another version, and one value of the wrong type
 * would be written straight into a translation file. An unreadable status is not a reason to drop
 * the words - it falls back to the weakest one that still says a human wrote them.
 */
function readLocalizationUnit(value: unknown): LocalizationUnit | null {
    if (value === null || typeof value !== "object") {
        return null;
    }
    const unit = value as Partial<LocalizationUnit>;
    if (typeof unit.target !== "string" || !unit.target) {
        return null;
    }
    return {
        target: unit.target,
        sourceHash: typeof unit.sourceHash === "string" ? unit.sourceHash : "",
        status: LOCALIZATION_STATUSES.has(unit.status as string) ? unit.status as LocalizationUnit["status"] : "translated",
        ...(typeof unit.note === "string" && unit.note ? { note: unit.note } : {}),
    };
}

/** One voice unit off the wire, or null when it is not one. See {@link readLocalizationUnit}. */
function readVoiceUnit(value: unknown): VoiceUnit | null {
    if (value === null || typeof value !== "object") {
        return null;
    }
    const unit = value as Partial<VoiceUnit>;
    if (typeof unit.assetId !== "string" || !unit.assetId) {
        return null;
    }
    return {
        assetId: unit.assetId,
        sourceHash: typeof unit.sourceHash === "string" ? unit.sourceHash : "",
        status: unit.status === "approved" ? "approved" : "linked",
        ...(typeof unit.duration === "number" && Number.isFinite(unit.duration) ? { duration: unit.duration } : {}),
        ...(typeof unit.note === "string" && unit.note ? { note: unit.note } : {}),
    };
}

const LOCALIZATION_STATUSES: ReadonlySet<string> = new Set(["untranslated", "machine", "translated", "reviewed"]);

/** The two libraries an effect's entries are written into, or null for one the window has no service for. */
export type LiveDerivedPorts = {
    translations: CarriedTranslationPort | null;
    voice: CarriedVoicePort | null;
};

export type LiveDerivedOutcome = {
    translations: number;
    voice: number;
};

/**
 * Write one effect's entries, inside the window that lets a session's freeze allow them.
 *
 * Run on **every** machine the effect reaches, the paster included, which is what makes the
 * libraries converge: one payload, one applier, the same bytes everywhere. The paster does not take
 * a shortcut through what it happens to have in memory, because a shortcut is a second
 * implementation and a second implementation is where two libraries part company.
 *
 * Translations before takes: a take is a recording of the line as the actor for that language reads
 * it - the translation, where the project has one - so a take that landed first would read as stale
 * until its translation caught up.
 *
 * The window is closed in a `finally` and on every path out. A hold leaked here does not cost a
 * refused write; it leaves the localization and voice libraries quietly writable for the rest of the
 * session, which is the one thing the window exists to prevent.
 */
export async function applyLiveDerived(
    projectPath: string,
    derived: LiveDerived,
    ports: LiveDerivedPorts,
): Promise<LiveDerivedOutcome> {
    const plans = planLiveDerived(derived);
    const outcome: LiveDerivedOutcome = { translations: 0, voice: 0 };
    const release = holdDerivedProjectWrites(projectPath);
    try {
        if (ports.translations && plans.translations.carried > 0) {
            const written = await writeCarriedTranslations(ports.translations, plans.translations);
            outcome.translations = written.written;
        }
        if (ports.voice && plans.voice.carried > 0) {
            // Opened first, exactly as a within-project carry opens them: a library nobody has read
            // yet cannot be written into, and this is the one chance to read it in.
            const { frozen } = await openVoiceLibraries(ports.voice, plans.voice.writes.map(write => write.locale));
            if (!frozen) {
                outcome.voice = writeCarriedVoice(ports.voice, plans.voice).written;
            }
        }
    } finally {
        release();
    }
    return outcome;
}

/**
 * The session that has already been told its pastes arrive as rows only.
 *
 * Module-level and keyed by the room, because the thing being limited is a session's worth of noise
 * and a session outlives every tab that was open during it: a latch held by the editor would speak
 * again each time the author closed and reopened a scene. A different room is a different session
 * and is told once itself.
 */
let noticedSession: string | null = null;

/**
 * Whether this session still has to be told, taking the right to say it in the same breath.
 *
 * Taken rather than asked so the count cannot drift from what was actually shown - a caller that
 * checked and then failed to show it would leave the session believing it had been told.
 */
export function takeSessionRowsOnlyNotice(session: string): boolean {
    if (noticedSession === session) {
        return false;
    }
    noticedSession = session;
    return true;
}
