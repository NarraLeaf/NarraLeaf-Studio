import { createTranslator, SUPPORTED_LOCALES, type Locale } from "../i18n";
import {
    AUDIO_TRACK_SCHEMA_VERSION,
    BUILTIN_AUDIO_TRACKS,
    factoryAudioTrackNameKey,
    type ProjectAudioTrack,
    type ProjectAudioTrackDocument,
} from "../types/audioTrack";
import { pickTemplateContentLocale } from "../types/projectTemplate";

/**
 * The three seeded audio tracks of a project that is being created, named in the language its story
 * is written in.
 *
 * A track's name is project content the way a scene's or a character's is: it is what a story row
 * types after `track=`, what a merge row and the agent's tools print, and what the author renames
 * in place. A project written in Chinese therefore starts with 音乐 / 音效 / 语音 rather than with
 * three English words, using the words Studio's own interface uses for the three tracks
 * (`project.audio.builtinName.*`) - one spelling of each, not a second list here.
 *
 * Only creation reads this. A project that already exists keeps the names it has, and one that
 * somehow has no track document is still seeded with the English names it has always been read
 * with (`createSeededAudioTrackDocument`); renaming tracks under an existing project would rewrite
 * the words its story rows were typed with.
 *
 * The language is chosen the way a template's language copy is chosen (`pickTemplateContentLocale`),
 * so a project made from the skeleton and one made empty name their tracks alike: `zh-CN` and
 * `zh-TW` both read Chinese, and a script language Studio has no interface words for keeps English.
 *
 * Comments in English per project convention.
 */

/** The interface language whose words name the tracks, or null for the English factory names. */
export function audioTrackNameLocaleFor(scriptLocale: string | null | undefined): Locale | null {
    const code = pickTemplateContentLocale(scriptLocale ?? "", SUPPORTED_LOCALES);
    return code && code !== "en" ? code as Locale : null;
}

/** The three seeded tracks as a project written in `scriptLocale` starts with them. */
export function newProjectAudioTracks(scriptLocale: string | null | undefined): ProjectAudioTrack[] {
    const locale = audioTrackNameLocaleFor(scriptLocale);
    const translate = locale ? createTranslator(locale).t : null;
    return BUILTIN_AUDIO_TRACKS.map(track => {
        const key = factoryAudioTrackNameKey(track);
        return { ...track, name: translate && key ? translate(key) : track.name };
    });
}

/** `editor/audio-tracks.json` for a project being created. */
export function newProjectAudioTrackDocument(
    scriptLocale: string | null | undefined,
    now: string,
): ProjectAudioTrackDocument {
    return {
        schemaVersion: AUDIO_TRACK_SCHEMA_VERSION,
        tracks: newProjectAudioTracks(scriptLocale),
        meta: { createdAt: now, updatedAt: now },
    };
}
