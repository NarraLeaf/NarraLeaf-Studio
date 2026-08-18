import { describe, expect, it } from "vitest";
import {
  STORY_COMMAND_CATEGORIES,
  STORY_COMMAND_GROUPS,
  getCommandGroup,
  type StoryCommandCategoryId,
  type StoryCommandGroupId
} from "../storyCommandCategories";
import { listCommandSpecs } from "./registry";
import {
  browseMenuStops,
  buildSpecSidebarGroups,
  dedupeToPrimarySubject,
  filterSidebarGroups,
  specGroupIds
} from "./specSidebar";

/**
 * The `accepts` classification rule, and the colour contract behind it.
 *
 * The rule is the whole reason the sidebar could stop being a second catalogue, so it is pinned by the
 * case that motivated it: `/show` is ONE spec that has to appear under five subjects. The colour
 * assertions are here because `iconColor` is the only source four shipped surfaces read - the row's
 * left bar, the badge, the `/` browse menu and the command reference - so a group added without one
 * would silently grey out committed rows rather than fail anything.
 */

const groupIds = (specId: string): readonly StoryCommandGroupId[] => {
  const spec = listCommandSpecs().find((candidate) => candidate.id === specId);
  if (!spec) {
    throw new Error(`no spec: ${specId}`);
  }
  return specGroupIds(spec);
};

const sidebar = () => buildSpecSidebarGroups([], (command) => command);

/** The spec ids filed under a group, as the sidebar would show them. */
const commandsIn = (groupId: StoryCommandGroupId): string[] =>
  sidebar()
    .find((entry) => entry.group.id === groupId)
    ?.commands.map((command) => command.id) ?? [];

describe("accepts-driven classification (§4.2)", () => {
  it("files a generic verb under every subject it accepts - /show reaches all six", () => {
    expect(groupIds("show")).toEqual(["character", "image", "text", "video", "layer", "vfx"]);
    expect(groupIds("hide")).toEqual(["character", "image", "text", "video", "layer", "vfx"]);
    for (const group of ["character", "image", "text", "video", "layer", "vfx"] as const) {
      expect(commandsIn(group)).toContain("show");
    }
  });

  it("does not file a verb under a subject it cannot act on", () => {
    // `/transform` writes a displayable payload: video, vfx and audio are not displayables, and
    // the sidebar must not offer it under them just because they are stage objects.
    expect(groupIds("transform")).toEqual(["image", "text", "layer", "character"]);
    expect(commandsIn("video")).not.toContain("transform");
    expect(commandsIn("sound")).not.toContain("transform");
    expect(commandsIn("vfx")).not.toContain("transform");
    expect(commandsIn("vfx")).not.toContain("fx");
    // ...and the mirror: an overlay's own verbs ARE there, because `accepts` lists it.
    expect(commandsIn("vfx")).toEqual(
      expect.arrayContaining(["vfx", "show", "hide", "pause", "resume", "rate"])
    );
    // The sound control family is the mirror case: audio only.
    expect(groupIds("volume")).toEqual(["sound"]);
    expect(commandsIn("image")).not.toContain("volume");
  });

  it("gives the layer subject the entries only the inspector used to reach (D4)", () => {
    expect(commandsIn("layer")).toEqual(
      expect.arrayContaining(["show", "hide", "transform", "fx", "layer"])
    );
  });

  it("files a command with no target by its own category - /camera lands in 镜头", () => {
    expect(groupIds("camera")).toEqual(["camera"]);
    expect(commandsIn("camera")).toContain("camera");
    expect(getCommandGroup("camera").category).toBe("camera");
  });

  it("routes the audio target kind to the sound group, the one name that is not its own", () => {
    // `/stop` also reaches video (A3), so it files under both - which is exactly what widening
    // `accepts` is supposed to buy: four video capabilities for one new token, and the transport
    // verbs visible where an author browsing 视频 will look for them.
    expect(groupIds("stop")).toEqual(["sound", "video"]);
    for (const id of ["stop", "pause", "resume"]) {
      expect(commandsIn("video")).toContain(id);
      expect(commandsIn("sound")).toContain(id);
    }
    expect(commandsIn("video")).toContain("seek");
  });

  it("leaves no spec unreachable from the sidebar", () => {
    const listed = new Set(
      sidebar().flatMap((entry) => entry.commands.map((command) => command.id))
    );
    for (const spec of listCommandSpecs()) {
      expect(listed.has(spec.id)).toBe(true);
    }
  });
});

/**
 * The `/` empty-state browse is the sidebar's projection, so `/show` shows
 * up under every subject there too. The catch A1 flagged: the highlight walked by command id, and a
 * verb repeated across subjects would have collided. The stop keys are the fix - one per rendered row -
 * so the invariant interaction-model rule 2 rests on ("the highlight is Enter's pointer") holds: one
 * keypress, one stop, and Enter takes the row on screen rather than the first that shares its id.
 */
describe("browse walk stops (§4.2, interaction rule 2)", () => {
  const stops = () => browseMenuStops(sidebar());

  it("files /show under all six subjects, once per subject, in the order they render", () => {
    // Sidebar/group order (STORY_COMMAND_GROUPS), not `accepts` order: the walk order is the order
    // the eye reads down the menu, so the two must be the same thing.
    const showStops = stops().filter((stop) => stop.command.id === "show");
    expect(showStops.map((stop) => stop.group.id)).toEqual([
      "character",
      "image",
      "text",
      "layer",
      "video",
      "vfx"
    ]);
  });

  it("gives every rendered row a distinct key, so the highlight never double-hits", () => {
    const keys = stops().map((stop) => stop.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("walks one row per keypress: a verb under six subjects is six separate stops", () => {
    // Six `/show` rows means six presses to pass them all - not one press that skips five. Each key
    // is `group:id`, so the same command id never merges two rows into one stop.
    const showStops = stops().filter((stop) => stop.command.id === "show");
    expect(showStops).toHaveLength(6);
    expect(new Set(showStops.map((stop) => stop.key)).size).toBe(6);
    expect(showStops.every((stop) => stop.command.id === "show")).toBe(true);
  });

  it("walks the stops in sidebar order, section by section", () => {
    const groups = sidebar();
    const expected = groups.flatMap((entry) =>
      entry.commands.map((command) => `${entry.group.id}:${command.id}`)
    );
    expect(stops().map((stop) => stop.key)).toEqual(expected);
  });
});

describe("the eight categories (§4.1, §12.3)", () => {
  it("cuts by exactly one criterion and keeps 舞台 as the only two-level category", () => {
    expect(STORY_COMMAND_CATEGORIES.map((category) => category.id)).toEqual([
      "character",
      "stage",
      "camera",
      "scene",
      "sound",
      "data",
      "flow",
      "utils"
    ]);
    const multiLevel = STORY_COMMAND_CATEGORIES.filter(
      (category) =>
        STORY_COMMAND_GROUPS.filter((group) => group.category === category.id).length > 1
    ).map((category) => category.id);
    expect(multiLevel).toEqual(["stage"]);
  });

  it("assigns every category and every group a complete icon and colour - nothing falls back to grey", () => {
    for (const entry of [...STORY_COMMAND_CATEGORIES, ...STORY_COMMAND_GROUPS]) {
      expect(entry.icon).toBeTruthy();
      expect(entry.iconColor).toMatch(/^(#|var\()/);
    }
  });

  it("keeps every category populated, so no chip opens onto an empty list", () => {
    for (const category of STORY_COMMAND_CATEGORIES) {
      expect(filterSidebarGroups(sidebar(), category.id).length).toBeGreaterThan(0);
    }
  });

  it("keeps the four stage subjects as separate colour units, so no row loses its hue", () => {
    const stageColors = STORY_COMMAND_GROUPS.filter((group) => group.category === "stage").map(
      (group) => group.iconColor
    );
    expect(new Set(stageColors).size).toBe(stageColors.length);
  });
});

/**
 * The exact hues, pinned - the assertion the "zero visual regression" promise actually rests on.
 *
 * Everything above only asks that a colour EXIST, so editing any hex would repaint the row's left bar,
 * the badge, the `/` browse menu and the command reference all at once and still pass the whole suite;
 * the promise would be held by nothing but screenshots. Written out as literals so changing a colour
 * costs a deliberate edit to a table that says "this is the colour" - which is the review four shipped
 * surfaces deserve.
 *
 * Both tables are exhaustive by type, so a category or group added without a pinned colour fails `tsc`
 * rather than slipping through unpinned. Nine of the eleven group hues predate the 13→8 rearrangement
 * unchanged; 流程 and 声音 carry 控制's and 媒体's old hex under new names, and 镜头 takes the warm tone
 * that dissolving 特效 freed - a rename is not a repaint.
 */
const CATEGORY_COLORS: Record<StoryCommandCategoryId, string> = {
  character: "var(--narraleaf-accent, #40a8c4)",
  stage: "#96b8a0",
  camera: "#d1a176",
  scene: "#8fa9c7",
  sound: "#bd97a3",
  data: "#b8aa86",
  flow: "#b2a6c9",
  utils: "#a8adb5"
};

const GROUP_COLORS: Record<StoryCommandGroupId, string> = {
  character: "var(--narraleaf-accent, #40a8c4)",
  image: "#96b8a0",
  text: "#9bb7d8",
  layer: "#92b9b0",
  video: "#b59dcc",
  // A later addition, and the only hue no group already wore - the palette's remaining gap.
  vfx: "#d3c07c",
  camera: "#d1a176",
  scene: "#8fa9c7",
  sound: "#bd97a3",
  data: "#b8aa86",
  flow: "#b2a6c9",
  utils: "#a8adb5"
};

describe("pinned colours (§12.3)", () => {
  it("holds every group to the exact hue its rows already wear", () => {
    const actual = Object.fromEntries(
      STORY_COMMAND_GROUPS.map((group) => [group.id, group.iconColor])
    );
    expect(actual).toEqual(GROUP_COLORS);
  });

  it("holds every category chip to the exact hue it browses under", () => {
    const actual = Object.fromEntries(
      STORY_COMMAND_CATEGORIES.map((category) => [category.id, category.iconColor])
    );
    expect(actual).toEqual(CATEGORY_COLORS);
  });

  it("keeps each category on its own group's hue, so a chip and its rows never disagree", () => {
    // 舞台 is the exception on purpose: a pure parent with four subjects, it borrows 图片's sage.
    for (const category of STORY_COMMAND_CATEGORIES) {
      const expected = category.id === "stage" ? GROUP_COLORS.image : GROUP_COLORS[category.id];
      expect(category.iconColor).toBe(expected);
    }
  });

  it("moves exactly the three commands A1 meant to move, and no others", () => {
    // A full-screen effect is a property of the scene it happens in, not a material domain of its
    // own, so these two left the dissolved 特效 for 场景 and took its hue.
    expect(groupIds("blink")).toEqual(["scene"]);
    expect(groupIds("vignette")).toEqual(["scene"]);
    expect(getCommandGroup("scene").iconColor).toBe(GROUP_COLORS.scene);
    // A blueprint call is a tool, not control flow.
    expect(groupIds("blueprint")).toEqual(["utils"]);
    expect(getCommandGroup("utils").iconColor).toBe(GROUP_COLORS.utils);
  });
});

/**
 * The one-row-per-command collapse the two "everything at once" surfaces share — the `/` browse, which
 * has no subject filter, and the sidebar's unfiltered tab.
 *
 * The failure it has to be held to is not the repeat it removes; it is losing a command outright. A
 * spec whose `category` is not among the subjects it accepts has no "home" section to be kept in, and
 * the naive rule ("keep it where its category says") would delete it from the vocabulary with nothing
 * to notice.
 */
describe("one row per command (the unfiltered collapse)", () => {
  const groups = buildSpecSidebarGroups([], (command) => command);
  const collapsed = dedupeToPrimarySubject(groups);

  it("shows every command exactly once", () => {
    const seen = new Map<string, number>();
    for (const entry of collapsed) {
      for (const command of entry.commands) {
        seen.set(command.id, (seen.get(command.id) ?? 0) + 1);
      }
    }
    const repeated = [...seen.entries()].filter(([, count]) => count > 1);
    expect(repeated).toEqual([]);
  });

  it("loses none of them", () => {
    const before = new Set(groups.flatMap((entry) => entry.commands.map((command) => command.id)));
    const after = new Set(
      collapsed.flatMap((entry) => entry.commands.map((command) => command.id))
    );
    expect([...before].filter((id) => !after.has(id))).toEqual([]);
    expect(after.size).toBe(before.size);
  });

  it("keeps a command under its own category when it is filed there", () => {
    // `/show` reaches five subjects; collapsed, it belongs to the one its spec calls home.
    const home = collapsed.find((entry) => entry.commands.some((command) => command.id === "show"));
    expect(home?.group.id).toBe("character");
  });

  it("leaves a chosen subject's full filing alone", () => {
    // The collapse is only for the unfiltered view: the 舞台 chip must still find "显示" under 图片
    // (the chip is a CATEGORY; 图片 is one of the four groups filed beneath it).
    const stage = filterSidebarGroups(groups, "stage");
    const image = stage.find((entry) => entry.group.id === "image");
    expect(image?.commands.map((command) => command.id)).toContain("show");
  });

  it("gives the browse walk one stop per row, still uniquely keyed", () => {
    const stops = browseMenuStops(collapsed);
    expect(new Set(stops.map((stop) => stop.key)).size).toBe(stops.length);
  });
});
