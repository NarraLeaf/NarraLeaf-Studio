import { describe, expect, it } from "vitest";
import {
  resolveStoryRowHighlight,
  STORY_ROW_HIGHLIGHT_DEFAULT,
  STORY_ROW_HIGHLIGHT_OPTIONS
} from "./storyRowHighlightOptions";

/**
 * The stored value is untyped JSON off global state, so it can be anything — a value written by an
 * older build, a hand-edited global.json, or the `undefined` a first run hands back. Every one of
 * those has to land on a mode the row can actually render: an unrecognised string would otherwise
 * reach the row and paint nothing while the settings page still showed a choice.
 */
describe("resolveStoryRowHighlight", () => {
  it("keeps every value the settings page can produce", () => {
    for (const option of STORY_ROW_HIGHLIGHT_OPTIONS) {
      expect(resolveStoryRowHighlight(option), option).toBe(option);
    }
  });

  it("falls back to the default for anything it does not recognise", () => {
    for (const stored of [undefined, null, "", "dialogue", "commands", true, 1, {}, []]) {
      expect(resolveStoryRowHighlight(stored), JSON.stringify(stored)).toBe(
        STORY_ROW_HIGHLIGHT_DEFAULT
      );
    }
  });

  /**
   * Not merely "some default" — specifically none. The tint repeats what the gutter mark already
   * says, so a document an author has never expressed an opinion about is left unpainted.
   */
  it("defaults to painting neither layer", () => {
    expect(STORY_ROW_HIGHLIGHT_DEFAULT).toBe("none");
    expect(STORY_ROW_HIGHLIGHT_OPTIONS).toEqual(["none", "script", "command"]);
  });
});
