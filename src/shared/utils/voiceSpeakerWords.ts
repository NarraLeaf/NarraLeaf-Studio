import { createTranslator, SUPPORTED_LOCALES, type Locale, type TranslationKey } from "../i18n";
import { pickTemplateContentLocale } from "../types/projectTemplate";

/**
 * The word a recording file name spells for a line no character speaks: narration, or a choice
 * option when options are voiced.
 *
 * `{character}` in the recording rule is a character's name, which is project content and the same
 * in every Studio. Narration and options have no name, so they are given a word - and that word used
 * to be the interface's, so the same project exported `放学后_001_旁白` from a Chinese Studio and
 * expected `放学后_001_Narration` back in an English one. The word is now the project's: Studio's own
 * word for it in the language the story is written in (the source language), picked the way a
 * template's language copy is picked, and English for a language Studio has no words for.
 *
 * Matching accepts every language's word, so takes named under the old rule, or by a booth working
 * from another Studio's script, still find their lines.
 *
 * Comments in English per project convention.
 */

export type VoiceUnnamedSpeaker = "narration" | "choice";

const SPEAKER_KEY: Record<VoiceUnnamedSpeaker, TranslationKey> = {
    narration: "workspace.voice.table.narrationSpeaker",
    choice: "workspace.voice.table.choiceSpeaker",
};

/** The Studio language whose words name unnamed speakers in a project written in `sourceLocale`. */
export function voiceSpeakerWordLocaleFor(sourceLocale: string | null | undefined): Locale {
    return (pickTemplateContentLocale(sourceLocale ?? "", SUPPORTED_LOCALES) ?? "en") as Locale;
}

/** The word a file name spells for `speaker` in a project written in `sourceLocale`. */
export function voiceSpeakerWord(speaker: VoiceUnnamedSpeaker, sourceLocale: string | null | undefined): string {
    return createTranslator(voiceSpeakerWordLocaleFor(sourceLocale)).t(SPEAKER_KEY[speaker]);
}

/** Every Studio language's word for `speaker`, without repeats. What a file name is matched against. */
export function voiceSpeakerWordsInEveryLanguage(speaker: VoiceUnnamedSpeaker): string[] {
    return [...new Set(SUPPORTED_LOCALES.map(locale => createTranslator(locale).t(SPEAKER_KEY[speaker])))];
}
