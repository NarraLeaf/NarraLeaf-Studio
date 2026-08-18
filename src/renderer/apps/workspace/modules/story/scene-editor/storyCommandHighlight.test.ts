import { afterEach, describe, expect, it } from "vitest";
import { i18nStore } from "@/lib/i18n";
import { getCommandSegments } from "./storyCommandHighlight";

afterEach(() => {
  i18nStore.setLocale("en");
});

/**
 * `[role]text` per segment — compact enough to read a whole line's colouring at a glance. A param key
 * reads as `[key]`: it is scaffold like everything else muted, but it is the one stretch a surface is
 * allowed to leave out, so a test that could not see it apart from the space beside it would not be
 * able to say where the "show only the values" cut falls.
 */
function shape(source: string): string {
  return getCommandSegments(source)
    .map((segment) => `[${segment.paramKey ? "key" : segment.role}]${segment.text}`)
    .join("");
}

describe("getCommandSegments", () => {
  it("colours by role, not by position", () => {
    expect(shape("/hide Narra t=fade d=1s")).toBe(
      "[scaffold]/[verb]hide[scaffold] [target]Narra[scaffold] [key]t=[value]fade[scaffold] [key]d=[value]1[scaffold]s"
    );
  });

  it("reproduces the source exactly, so an overlay can sit on the field", () => {
    // The load-bearing property: the mirror has to occupy the same width as the text beneath it,
    // character for character, or the colours drift away from the caret as the line grows.
    for (const source of [
      "/hide Narra t=fade d=1s",
      "/bg forest_day",
      "/say Alice Hello, world",
      "/set 'boss hp' += 2",
      "/bg   forest   t=fade  ",
      "/hi",
      "/",
      "",
      "/背景 forest 转场=淡变"
    ]) {
      expect(
        getCommandSegments(source)
          .map((segment) => segment.text)
          .join(""),
        source
      ).toBe(source);
    }
  });

  it("keeps the scaffold muted — the trigger, the binders, the keys and the unit", () => {
    const scaffold = getCommandSegments("/hide Narra t=fade d=1s")
      .filter((segment) => segment.role === "scaffold")
      .map((segment) => segment.text);
    // The `s` is in here on purpose: `1s` is one second, and the unit says which KIND of one it
    // is — the same job the key does — so it recedes with the key rather than lighting up as a value.
    // The keys are their own segments (see `shape`), and the space in front of each is not: it
    // separates two tokens and has to survive a surface that drops the key.
    expect(scaffold).toEqual(["/", " ", " ", "t=", " ", "d=", "s"]);
  });

  it("marks the key and its binder, and nothing else, as the part a surface may drop", () => {
    // The cut "show only the values" makes. It has to land on `t=` exactly: one character short and
    // the row shows a stray `=`, one too many and two tokens run together as `Narrafade`.
    const keys = (source: string) =>
      getCommandSegments(source)
        .filter((segment) => segment.paramKey)
        .map((segment) => segment.text);
    expect(keys("/hide Narra t=fade d=1s")).toEqual(["t=", "d="]);
    // A bare flag parses with its key and value on the same span — there is no `=` to cut at, and
    // dropping the word would erase the arg rather than shorten it.
    expect(keys("/bgm battle loop")).toEqual([]);
    // An unrecognized key stays: it is the evidence for the diagnostic sitting underneath it.
    expect(keys("/hide Narra nope=1")).toEqual([]);
    // Nothing to drop on a line written entirely in positionals.
    expect(keys("/bg forest_day")).toEqual([]);
  });

  it("gives a half-typed verb its colour rather than letting the line flicker", () => {
    // `/hi` names no command yet. Going dark on every intermediate keystroke and lighting back up
    // at the last one is a worse read than simply being the verb slot the whole way.
    expect(shape("/hi")).toBe("[scaffold]/[verb]hi");
    expect(shape("/")).toBe("[scaffold]/");
  });

  it("reads a Chinese line the same way — the roles do not move", () => {
    // The whole premise of the display-language switch: same skeleton, different skin. Token
    // roles, order and boundaries all correspond one to one with the English line. The locale has
    // to be set for the same reason the parser needs it: `背景` is only a command word in Chinese.
    i18nStore.setLocale("zh");
    expect(shape("/背景 forest 转场=淡变")).toBe(
      "[scaffold]/[verb]背景[scaffold] [target]forest[scaffold] [key]转场=[value]淡变"
    );
    expect(shape("/bg forest t=fade")).toBe(
      "[scaffold]/[verb]bg[scaffold] [target]forest[scaffold] [key]t=[value]fade"
    );
  });

  it("gives an unknown command word the verb colour and leaves the rest alone", () => {
    // In English `背景` names nothing, so there is no grammar to colour the rest by. The verb slot
    // still reads as the verb slot — the line is being typed, not diagnosed.
    expect(shape("/背景 forest 转场=淡变")).toBe(
      "[scaffold]/[verb]背景[scaffold] forest 转场=淡变"
    );
  });

  it("decides target-vs-value by what the slot holds, not by where it sits", () => {
    // `/bg` names its object `image` and `/hide` names its `target`; both are the thing acted on.
    expect(shape("/bg forest_day")).toBe("[scaffold]/[verb]bg[scaffold] [target]forest_day");
    expect(shape("/set gold += 1")).toBe(
      "[scaffold]/[verb]set[scaffold] [target]gold[scaffold] [value]+= 1"
    );
    // A leading NUMBER is a value, not an object — `/vol 0.5` sets a volume, it does not act on 0.5.
    expect(shape("/vol 0.5")).toBe("[scaffold]/[verb]vol[scaffold] [value]0.5");
    expect(shape("/wait 5")).toBe("[scaffold]/[verb]wait[scaffold] [value]5");
  });

  it("says nothing about a line that is not a command", () => {
    expect(getCommandSegments("just narration")).toEqual([
      { text: "just narration", role: "scaffold" }
    ]);
    expect(getCommandSegments("#Alice hello")).toEqual([
      { text: "#Alice hello", role: "scaffold" }
    ]);
  });

  it("treats a quoted value as one value, quotes included", () => {
    expect(shape("/jump 'Scene Name'")).toBe(
      "[scaffold]/[verb]jump[scaffold] [target]'Scene Name'"
    );
  });
});
