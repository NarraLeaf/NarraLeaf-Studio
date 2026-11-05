import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator } from "../i18n";
import { BUILTIN_AUDIO_TRACKS, createSeededAudioTrackDocument, migrateProjectAudioTrackDocument } from "../types/audioTrack";
import { newProjectFiles } from "./newProject";
import { audioTrackNameLocaleFor, newProjectAudioTrackDocument, newProjectAudioTracks } from "./newProjectAudioTracks";

const names = (locale: string | null | undefined) => newProjectAudioTracks(locale).map(track => track.name);

describe("the audio tracks a new project starts with", () => {
    it("are named in the project's script language, with Studio's words for the three tracks", () => {
        expect(names("zh-CN")).toEqual(["音乐", "音效", "语音"]);
        expect(names("ja")).toEqual(["音楽", "効果音", "ボイス"]);
        for (const locale of ["zh", "ja"] as const) {
            const { t } = createTranslator(locale);
            expect(names(locale)).toEqual([
                t("project.audio.builtinName.bgm"),
                t("project.audio.builtinName.sound"),
                t("project.audio.builtinName.voice"),
            ]);
        }
    });

    it("keep the English names in English, in a language Studio has no words for, and with no language", () => {
        for (const locale of ["en", "en-GB", "fr", "", null, undefined]) {
            expect(names(locale)).toEqual(["Music", "SFX", "Voice"]);
        }
    });

    it("pick the language the way a template's language copy is picked", () => {
        expect(audioTrackNameLocaleFor("zh-Hans")).toBe("zh");
        expect(audioTrackNameLocaleFor("zh-TW")).toBe("zh");
        expect(audioTrackNameLocaleFor("ja-JP")).toBe("ja");
        expect(audioTrackNameLocaleFor("en-US")).toBeNull();
    });

    it("differ from the seeded tracks only by name", () => {
        const tracks = newProjectAudioTracks("zh-CN");
        expect(tracks.map(({ name: _name, ...rest }) => rest))
            .toEqual(BUILTIN_AUDIO_TRACKS.map(({ name: _name, ...rest }) => rest));
    });

    it("are a document the track service reads back unchanged", () => {
        const document = newProjectAudioTrackDocument("ja", "2026-10-14T00:00:00.000Z");
        expect(migrateProjectAudioTrackDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
    });

    it("are written into the new project's files, while a project with no track file still seeds English", () => {
        const file = newProjectFiles({ width: 1920, height: 1080 }, () => "id", "zh-CN")
            .find(entry => entry.path.join("/") === "editor/audio-tracks.json");
        expect(file).toBeDefined();
        const written = JSON.parse(file!.text) as { tracks: { name: string }[] };
        expect(written.tracks.map(track => track.name)).toEqual(["音乐", "音效", "语音"]);
        expect(createSeededAudioTrackDocument().tracks.map(track => track.name)).toEqual(["Music", "SFX", "Voice"]);
    });
});

describe("the skeleton template's audio tracks", () => {
    const root = path.resolve(__dirname, "../../../resources/templates/skeleton");
    const read = (tree: string) => (
        JSON.parse(fs.readFileSync(path.join(root, tree, "editor/audio-tracks.json"), "utf-8")) as {
            tracks: { id: string; name: string }[];
        }
    ).tracks.map(track => track.name);

    it.each([["content", "en"], ["content.zh", "zh"], ["content.ja", "ja"]])(
        "in %s are the names an empty project in that language starts with",
        (tree, locale) => {
            expect(read(tree)).toEqual(names(locale));
        },
    );
});
