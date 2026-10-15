/**
 * The Config page's Music, SFX and Voice rows are three placements of one Volume slider
 * component, and each names the track it sets in the component's track parameter.
 *
 * That parameter is an audio track, so a placement picks its track from the project's tracks by
 * name instead of typing a track's id. What has to hold for the rows to keep working is that every
 * placement still names a track the project has - the three factory tracks, one row each - in the
 * English template and in the two generated from it.
 *
 * Each row is labelled with Studio's own word for what it sets: the track's name (the one a new
 * project gives the track in that language) and, for the master row, the word Studio's audio
 * status lines use for the slider over everything. An author reads a sound's track and slider in
 * Studio and finds the same word on the game's settings page.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator, type TranslationKey } from "@shared/i18n";
import { audioTrackNameLocaleFor } from "@shared/project/newProjectAudioTracks";
import { getUIComponentLink, isUIComponentAudioTrackParam, type UIDocument } from "@shared/types/ui-editor/document";
import { hashSourceText } from "@shared/utils/localizationText";

const VOLUME_SLIDER = "79c6ced1-12f6-44c7-be92-4f127dbd00d5";
const MASTER_VOLUME_SLIDER = "c91eb37e-b2db-4211-b6ff-a112f6f6a339";
/** Each sound row's slider, by element id, and Studio's word for what it sets. */
const ROW_WORDS: Record<string, TranslationKey> = {
    [MASTER_VOLUME_SLIDER]: "project.audio.slider.global",
    "config-bgm-volume": "project.audio.builtinName.bgm",
    "config-sfx-volume": "project.audio.builtinName.sound",
    "config-voice-volume": "project.audio.builtinName.voice",
};
/** The language each tree is written in. */
const TREE_LOCALES: Record<string, string> = { content: "en", "content.zh": "zh-CN", "content.ja": "ja" };

const studioWord = (locale: string, key: TranslationKey) => createTranslator(audioTrackNameLocaleFor(locale) ?? "en").t(key);

/** The localization key of the one text label in the row a slider sits in. */
function rowLabelKey(document: UIDocument, sliderId: string): string | undefined {
    const row = document.elements[document.elements[sliderId]?.parentId ?? ""];
    const keys = (row?.childrenIds ?? [])
        .map(id => document.elements[id])
        .filter(element => element?.type === "nl.text")
        .map(element => element.props?.localizationKey)
        .filter((key): key is string => typeof key === "string");
    return keys.length === 1 ? keys[0] : undefined;
}
/** The row each placement sits in, by element id, and the factory track it sets. */
const ROWS: Record<string, string> = {
    "config-bgm-volume": "bgm",
    "config-sfx-volume": "sound",
    "config-voice-volume": "voice",
};

const ROOT = path.join(process.cwd(), "resources/templates/skeleton");
const factoryTrackIds = (
    JSON.parse(fs.readFileSync(path.join(ROOT, "content/editor/audio-tracks.json"), "utf-8")) as {
        tracks: { id: string; builtin?: boolean }[];
    }
).tracks.filter(track => track.builtin).map(track => track.id);

describe.each(["content", "content.zh", "content.ja"])("the Volume slider in %s", tree => {
    const document = JSON.parse(fs.readFileSync(path.join(ROOT, tree, "editor/ui/uidoc.json"), "utf-8")) as UIDocument;
    const component = (document.components ?? []).find(candidate => candidate.id === VOLUME_SLIDER);

    it("takes its track as an audio track, falling back to the music track", () => {
        const track = component?.params?.find(param => param.id === "track");
        expect(track && isUIComponentAudioTrackParam(track)).toBe(true);
        expect(track?.defaultValue).toBe("bgm");
    });

    it("is placed once per factory track, each row naming its own", () => {
        const placements = Object.values(document.elements)
            .filter(element => getUIComponentLink(element)?.componentId === VOLUME_SLIDER)
            .map(element => [element.id, getUIComponentLink(element)?.params?.track]);

        expect(Object.fromEntries(placements)).toEqual(ROWS);
        expect([...Object.values(ROWS)].sort()).toEqual([...factoryTrackIds].sort());
    });
});

describe.each(Object.entries(TREE_LOCALES))("the sound rows' labels in %s", (tree, sourceLocale) => {
    const localizationDir = path.join(ROOT, tree, "editor/localization");
    const read = (file: string) => JSON.parse(fs.readFileSync(path.join(localizationDir, file), "utf-8"));
    const document = JSON.parse(fs.readFileSync(path.join(ROOT, tree, "editor/ui/uidoc.json"), "utf-8")) as UIDocument;
    const keys = read("keys.json").keys as Record<string, { sourceText: string }>;
    const translations = fs.readdirSync(localizationDir)
        .filter(name => name.endsWith(".json") && name !== "keys.json")
        .map(name => [name.slice(0, -".json".length), read(name).units] as const) as
        [string, Record<string, { sourceHash: string; target: string }>][];

    it("say what Studio calls each row's track, in the language the project is written in", () => {
        for (const [sliderId, word] of Object.entries(ROW_WORDS)) {
            const keyName = rowLabelKey(document, sliderId);
            expect(keyName, sliderId).toBeDefined();
            expect(keys[keyName!]?.sourceText, keyName).toBe(studioWord(sourceLocale, word));
        }
    });

    it("carry Studio's words in each language the project is translated into", () => {
        expect(translations).toHaveLength(2);
        for (const [sliderId, word] of Object.entries(ROW_WORDS)) {
            const keyName = rowLabelKey(document, sliderId)!;
            for (const [locale, units] of translations) {
                const unit = units[`key:${keyName}`];
                expect(unit?.target, `${keyName} in ${locale}`).toBe(studioWord(locale, word));
                expect(unit?.sourceHash, `${keyName} in ${locale}`).toBe(hashSourceText(keys[keyName].sourceText));
            }
        }
    });
});
