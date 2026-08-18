import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { PaletteActionCommand } from "./storyActionCommands";
import { getDefById, listCommandSpecs } from "./commands/registry";
import { specPaletteCommands } from "./commands/specPalette";
import {
  characterScopeLead,
  characterScopedActions,
  characterScopedSidebarGroups,
  commandLeadsWithCharacter,
  dialogueActionCharacter,
  isCharacterScopedAction,
  paragraphActionCharacterId
} from "./storyCharacterActions";
import { buildSpecSidebarGroups } from "./commands/specSidebar";

/**
 * The line under a speaker offers that speaker's verbs and nothing else, so what counts as "theirs"
 * is pinned here — including the two that are easy to forget are theirs (`/transform`, `/fx` accept a
 * character) and the ones that are easy to assume are (`/bg`, `/bgm`, `/set` never touch one).
 */

const def = (id: string) => {
  const found = getDefById(id);
  if (!found) {
    throw new Error(`no def: ${id}`);
  }
  return found;
};

const character = (id: string, name: string) =>
  ({ profile: { getId: () => id, getName: () => name } }) as unknown as Character;

const dialogue = (speaker: { characterId?: string; speakerName?: string }): StoryBlock => ({
  id: "row",
  parentId: null,
  childrenIds: [],
  kind: "nodeAction",
  payload: { action: "dialogue", text: { textId: "t", value: "", role: "dialogue" }, ...speaker }
});

describe("storyCharacterActions — which verbs a speaker's line may insert", () => {
  it("offers every verb that acts on a character already on stage, and only those", () => {
    const scoped = characterScopedActions(specPaletteCommands())
      .map((command) => command.id)
      .sort();
    // `/transform` and `/fx` are here because their target `accepts` includes a character — the
    // same rule the sidebar files them by. Hard-coding a list of "character commands" instead is
    // exactly the object-type × verb matrix the taxonomy exists to refuse.
    expect(scoped).toEqual(
      ["face", "fx", "motion", "move", "param", "rename", "say", "skin", "transform"].sort()
    );
  });

  it("leaves the staging pair out — the speaker of the line is already on stage", () => {
    const scoped = new Set(
      characterScopedActions(specPaletteCommands()).map((command) => command.id)
    );
    expect(scoped.has("show")).toBe(false);
    expect(scoped.has("hide")).toBe(false);
  });

  it("leaves out the verbs that never name a character", () => {
    const scoped = new Set(
      characterScopedActions(specPaletteCommands()).map((command) => command.id)
    );
    for (const id of [
      "background",
      "bgm",
      "sound",
      "image",
      "video",
      "set",
      "jump",
      "menu",
      "note"
    ]) {
      expect(scoped.has(id)).toBe(false);
    }
  });

  it("takes a plugin action at the word of its own registration", () => {
    const plugin = (group: string): PaletteActionCommand =>
      ({ id: "plugin:whatever", group, label: "", detail: "" }) as PaletteActionCommand;
    expect(isCharacterScopedAction(plugin("character"))).toBe(true);
    expect(isCharacterScopedAction(plugin("sound"))).toBe(false);
  });

  it("narrows the browse projection to the one section", () => {
    const groups = characterScopedSidebarGroups(buildSpecSidebarGroups([], (command) => command));
    expect(groups.map((entry) => entry.group.id)).toEqual(["character"]);
    // Every spec the scoped list names has to be reachable by browsing too, or the menu would
    // offer a verb while typing that it never shows on an empty query.
    const browsable = new Set(groups[0].commands.map((command) => command.id));
    for (const command of characterScopedActions(specPaletteCommands())) {
      expect(browsable.has(command.id)).toBe(true);
    }
  });
});

describe("storyCharacterActions — filling the speaker in", () => {
  it("writes the name for a verb whose first slot is the character, however that slot is spelled", () => {
    // `/face` names a character directly; `/show` takes the generic subject slot. Both lead with it.
    expect(commandLeadsWithCharacter(def("face"))).toBe(true);
    expect(commandLeadsWithCharacter(def("show"))).toBe(true);
    expect(characterScopeLead(def("face"), "Alice")).toBe("Alice ");
  });

  it("quotes a name the tokenizer would otherwise split apart", () => {
    expect(characterScopeLead(def("rename"), "The Stranger")).toBe("'The Stranger' ");
  });

  it("writes nothing for a verb that does not lead with a character", () => {
    expect(commandLeadsWithCharacter(def("background"))).toBe(false);
    expect(characterScopeLead(def("background"), "Alice")).toBe("");
  });

  it("has a lead for every scoped verb it offers", () => {
    // The scope's whole promise is that the pick lands ready to go. A spec that reached the menu
    // without a character slot to fill would break it silently, one verb at a time.
    for (const spec of listCommandSpecs()) {
      if (
        !characterScopedActions(specPaletteCommands()).some((command) => command.id === spec.id)
      ) {
        continue;
      }
      expect(characterScopeLead(def(spec.id), "Alice")).toBe("Alice ");
    }
  });
});

describe("storyCharacterActions — whose line it is", () => {
  const cast = [character("alice", "Alice")];

  it("finds the speaker a dialogue row points at", () => {
    expect(
      dialogueActionCharacter(dialogue({ characterId: "alice" }), cast)?.profile.getName()
    ).toBe("Alice");
  });

  it("declines a bare speaker name — there is no record for those verbs to act on", () => {
    expect(dialogueActionCharacter(dialogue({ speakerName: "the man in grey" }), cast)).toBeNull();
  });

  it("declines an id nothing in the cast answers to", () => {
    expect(dialogueActionCharacter(dialogue({ characterId: "deleted" }), cast)).toBeNull();
  });

  it("declines a row that is not dialogue at all", () => {
    const narration = {
      id: "row",
      parentId: null,
      childrenIds: [],
      kind: "narration",
      payload: { text: { value: "" } }
    } as unknown as StoryBlock;
    expect(dialogueActionCharacter(narration, cast)).toBeNull();
  });
});

describe("storyCharacterActions — what a speaker's paragraph absorbs", () => {
  const cast = [character("alice", "Alice")];
  const action = (payload: Record<string, unknown>): StoryBlock =>
    ({
      id: "row",
      parentId: null,
      childrenIds: [],
      kind: "action",
      payload
    }) as unknown as StoryBlock;

  it("absorbs every verb done to the speaker, not just the expression it started with", () => {
    for (const operation of [
      "expression",
      "move",
      "setMotion",
      "setSkin",
      "setParams",
      "setName"
    ]) {
      expect(
        paragraphActionCharacterId(
          action({ action: "character", operation, characterId: "alice" }),
          cast
        )
      ).toBe("alice");
    }
  });

  it("refuses the staging pair — a run must not draw its rule through the row that ends it", () => {
    for (const operation of ["enter", "exit"]) {
      expect(
        paragraphActionCharacterId(
          action({ action: "character", operation, characterId: "alice" }),
          cast
        )
      ).toBeNull();
    }
  });

  it("resolves a displayable target by name, which is all /fx and /transform ever store", () => {
    const fx = action({
      action: "displayable",
      operation: "filter",
      target: { kind: "character", name: "Alice" }
    });
    expect(paragraphActionCharacterId(fx, cast)).toBe("alice");
    // A layer or an image of the same name is a different subject entirely.
    const layer = action({
      action: "displayable",
      operation: "transform",
      target: { kind: "layer", name: "Alice" }
    });
    expect(paragraphActionCharacterId(layer, cast)).toBeNull();
  });

  it("stays silent about a row with no speaker to borrow", () => {
    expect(
      paragraphActionCharacterId(action({ action: "character", operation: "move" }), cast)
    ).toBeNull();
    expect(
      paragraphActionCharacterId(action({ action: "setBackground", color: "#000" }), cast)
    ).toBeNull();
    expect(paragraphActionCharacterId(dialogue({ characterId: "alice" }), cast)).toBeNull();
  });
});
