import { afterEach, describe, expect, it } from "vitest";
import { commandI18nStore, i18nStore } from "@/lib/i18n";
import { LOCALIZED_COMMANDS_DEFAULT } from "@/lib/settings/commandLanguageOptions";
import { migrateStoryDocumentToLatest } from "@shared/story/migrateStoryDocument";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { storyCommandSpelling } from "./commandSpelling";
import { findParam } from "../storyCommandGrammar";
import { localizedParamKey } from "./localizedParams";
import { localizedUnit } from "./localizedUnits";
import { getCommandDef, localizedCommandToken } from "./registry";

/**
 * The words a migration note is written in: the story editor's own tables, read in the command
 * language in effect, so the note left in place of a row reads like the rows around it.
 */

afterEach(() => {
    commandI18nStore.setPreference(LOCALIZED_COMMANDS_DEFAULT);
    i18nStore.setLocale("en");
});

/** A v26 scene holding one video row no play defines, so the ladder turns it into a note. */
function noteFor(payload: Record<string, unknown>): string {
    const block = { id: "row", kind: "action", parentId: null, childrenIds: [], payload } as unknown as StoryBlock;
    const document = {
        schemaVersion: 26,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: { "scene-1": { id: "scene-1", name: "Scene", runtimeName: "scene", rootBlockIds: ["row"], blocks: { row: block } } },
    } as unknown as StoryDocument;
    const migrated = migrateStoryDocumentToLatest(document, { commandSpelling: storyCommandSpelling() });
    const note = migrated.scenes["scene-1"].blocks.row as unknown as { kind: string; payload: { text: { value: string } } };
    expect(note.kind).toBe("note");
    return note.payload.text.value;
}

describe("storyCommandSpelling", () => {
    it("writes the canonical words in English, keeping the token a line was typed with", () => {
        i18nStore.setLocale("en");
        expect(noteFor({ action: "video", operation: "seek", objectName: "cutscene", timeMs: 1000 })).toBe("/seek cutscene 1s");
        expect(noteFor({ action: "video", operation: "hide", objectName: "cutscene", durationMs: 500 })).toBe("/hide cutscene out=fade d=0.5s");
        expect(noteFor({ action: "video", operation: "create", objectName: "opening", muted: true })).toBe("/video name=opening muted");
    });

    it("writes the Chinese command language's verb, keys, words and unit", () => {
        i18nStore.setLocale("zh");
        const seek = getCommandDef("seek")!;
        const hide = getCommandDef("hide")!;
        const verb = localizedCommandToken(seek);
        const second = localizedUnit("s");
        // The vocabulary does translate these, so the note below is not the English line again.
        expect(verb).not.toBe("seek");
        expect(second).not.toBe("s");
        expect(noteFor({ action: "video", operation: "seek", objectName: "cutscene", timeMs: 1000 })).toBe(`/${verb} cutscene 1${second}`);
        const fade = noteFor({ action: "video", operation: "hide", objectName: "cutscene", durationMs: 500 });
        expect(fade.startsWith(`/${localizedCommandToken(hide)} cutscene ${localizedParamKey(hide, findParam(hide, "out")!)}=`)).toBe(true);
        expect(fade.endsWith(`${localizedParamKey(hide, findParam(hide, "d")!)}=0.5${second}`)).toBe(true);
    });

    it("writes the canonical words when the command vocabulary is kept in English", () => {
        i18nStore.setLocale("zh");
        commandI18nStore.setPreference(false);
        expect(noteFor({ action: "video", operation: "seek", objectName: "cutscene", timeMs: 1000 })).toBe("/seek cutscene 1s");
    });
});
