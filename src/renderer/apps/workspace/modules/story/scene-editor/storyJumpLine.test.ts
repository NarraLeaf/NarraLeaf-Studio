import { afterEach, describe, expect, it } from "vitest";
import type { StoryScene, StorySceneId } from "@shared/types/story";
import { commandI18nStore, i18nStore } from "@/lib/i18n";
import { LOCALIZED_COMMANDS_DEFAULT } from "@/lib/settings/commandLanguageOptions";
import { parseCommandLine } from "./storyCommandParser";
import { writeStoryJumpLine } from "./storyJumpLine";

function scene(id: string, name: string): StoryScene {
  return { id, name, runtimeName: id, rootBlockIds: [], blocks: {} };
}

const SCENES: Record<StorySceneId, StoryScene> = {
  s1: scene("s1", "Chapter 2"),
  s2: scene("s2", "Hallway"),
  s3: scene("s3", "It's Over")
};

afterEach(() => {
  commandI18nStore.setPreference(LOCALIZED_COMMANDS_DEFAULT);
  i18nStore.setLocale("en");
});

/**
 * The line the scene flow map hands the editor.
 *
 * What every case here is really asserting is that it is a line the AUTHOR could have typed: it is
 * about to sit in an insert slot with their caret on it, and a spelling their own parser rejects
 * would land them in a draft row they did not write and cannot commit.
 */
describe("writeStoryJumpLine", () => {
  it("names the scene, never its id", () => {
    expect(writeStoryJumpLine("s2", SCENES)).toBe("/jump Hallway");
  });

  it("quotes a name the tokenizer would otherwise split", () => {
    // Bare, "Chapter 2" is two tokens and the jump would resolve against "Chapter".
    expect(writeStoryJumpLine("s1", SCENES)).toBe("/jump 'Chapter 2'");
    // A name carrying an apostrophe takes the other quote — there is no escape syntax.
    expect(writeStoryJumpLine("s3", SCENES)).toBe(`/jump "It's Over"`);
  });

  it("speaks the author's command language", () => {
    i18nStore.setLocale("zh");
    expect(writeStoryJumpLine("s2", SCENES)).toBe("/跳转 Hallway");
  });

  it("wears the trigger the author actually types", () => {
    expect(writeStoryJumpLine("s2", SCENES, "@")).toBe("@jump Hallway");
  });

  it("parses back as a jump to that scene", () => {
    // The round trip is the point: the Enter that commits this line runs it through the same
    // parser, so a line that reads well and resolves to nothing is the failure worth catching.
    for (const sceneId of ["s1", "s2", "s3"]) {
      const line = parseCommandLine(writeStoryJumpLine(sceneId, SCENES));
      expect(line.kind).toBe("command");
      expect(line.kind === "command" && line.def?.commandId).toBe("jump");
    }
  });

  it("says nothing at all when the target scene has gone", () => {
    // A scene deleted between the drag and the drop. Left to the projection this reads
    // `/jump 'unknown scene'` — the row's placeholder for a broken jump, which is exactly the
    // wrong thing to hand someone whose next keystroke commits the line. No line, no slot.
    expect(writeStoryJumpLine("missing", SCENES)).toBe("");
  });
});
