import { afterEach, describe, expect, it } from "vitest";
import { commandI18nStore, i18nStore } from "@/lib/i18n";
import { LOCALIZED_COMMANDS_DEFAULT } from "@/lib/settings/commandLanguageOptions";
import { getCommandCandidates } from "../storyCommandCandidates";
import { getCommandCursor } from "../storyCommandCursor";
import { parseCommandLine } from "../storyCommandParser";
import { EMPTY_STORY_COMMAND_CONTEXT, resolveCommandLine, type StoryCommandContext } from "../storyCommandResolution";

/**
 * The reserved target words (`camera`, `background`, `backgroundLayer`, `displayableLayer`) stay
 * English on the line in every locale, and a zh or ja author could neither read them nor find them:
 * the menu listed four English words, and 「镜头」 matched nothing. The menu now names each one in the
 * command language beside the word, and that name finds and resolves it; the line keeps the word.
 */

const CONTEXT: StoryCommandContext = {
    ...EMPTY_STORY_COMMAND_CONTEXT,
    characters: [{ id: "c1", name: "Narra" }],
    stageObjects: { ...EMPTY_STORY_COMMAND_CONTEXT.stageObjects, image: ["背景"] },
};

function candidates(marked: string, context: StoryCommandContext = CONTEXT) {
    const caret = marked.indexOf("|");
    return getCommandCandidates(getCommandCursor(marked.replace("|", ""), caret), context, {});
}

function target(source: string, context: StoryCommandContext = CONTEXT) {
    const line = parseCommandLine(source);
    return resolveCommandLine(line, context).args.target;
}

afterEach(() => {
    commandI18nStore.setPreference(LOCALIZED_COMMANDS_DEFAULT);
    i18nStore.setLocale("en");
});

describe("a reserved target word in a zh or ja slot", () => {
    it("is listed with its name in the command language", () => {
        i18nStore.setLocale("zh");
        const listed = candidates("/重置 |").filter(candidate => candidate.mark?.kind === "reservedTarget");
        expect(listed.map(candidate => [candidate.value, candidate.detail])).toEqual([
            ["camera", "镜头"],
            ["background", "背景"],
            ["backgroundLayer", "背景图层"],
            ["displayableLayer", "基准图层"],
        ]);
    });

    it("is found by that name, and inserts the word", () => {
        i18nStore.setLocale("zh");
        expect(candidates("/重置 镜|").map(candidate => candidate.value)).toEqual(["camera"]);
        i18nStore.setLocale("ja");
        expect(candidates("/リセット カメ|").map(candidate => candidate.value)).toEqual(["camera"]);
    });

    it("resolves from that name when it is typed out", () => {
        i18nStore.setLocale("zh");
        expect(target("/重置 镜头 持续时间=1")).toEqual({ kind: "target", target: { type: "reserved", name: "camera" } });
        expect(target("/变换 基准图层 缩放=1.2")).toEqual({ kind: "target", target: { type: "reserved", name: "displayableLayer" } });
        i18nStore.setLocale("ja");
        expect(target("/リセット カメラ")).toEqual({ kind: "target", target: { type: "reserved", name: "camera" } });
    });

    it("leaves a name the author gave something to that thing", () => {
        i18nStore.setLocale("zh");
        // A picture named 背景 is on stage: the name means the picture, not the scene background.
        expect(target("/变换 背景 缩放=1.2")).toMatchObject({ kind: "target", target: { type: "stageObject", objectKind: "image", name: "背景" } });
        // Without it, 背景 is the scene background.
        const bare = { ...CONTEXT, stageObjects: EMPTY_STORY_COMMAND_CONTEXT.stageObjects };
        expect(target("/变换 背景 缩放=1.2", bare)).toEqual({ kind: "target", target: { type: "reserved", name: "background" } });
    });

    it("adds nothing in English, where the name only spells the word again", () => {
        i18nStore.setLocale("en");
        const camera = candidates("/reset |").find(candidate => candidate.value === "camera");
        expect(camera?.detail).toBeUndefined();
        expect(target("/reset camera")).toEqual({ kind: "target", target: { type: "reserved", name: "camera" } });
    });
});
