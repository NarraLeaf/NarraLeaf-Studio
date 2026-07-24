import { describe, expect, it } from "vitest";
import {
    STORY_COMMAND_CATEGORIES,
    STORY_COMMAND_GROUPS,
    getCommandGroup,
    type StoryCommandCategoryId,
    type StoryCommandGroupId,
} from "../storyCommandCategories";
import { listCommandSpecs } from "./registry";
import { buildSpecSidebarGroups, filterSidebarGroups, specGroupIds } from "./specSidebar";

/**
 * The `accepts` classification rule (plan §4.2) and the colour contract A1 was warned about (§12.3).
 *
 * The rule is the whole reason the sidebar could stop being a second catalogue, so it is pinned by the
 * case that motivated it: `/show` is ONE spec that has to appear under five subjects. The colour
 * assertions are here because `iconColor` is the only source four shipped surfaces read - the row's
 * left bar, the badge, the `/` browse menu and the command reference - so a group added without one
 * would silently grey out committed rows rather than fail anything.
 */

const groupIds = (specId: string): readonly StoryCommandGroupId[] => {
    const spec = listCommandSpecs().find(candidate => candidate.id === specId);
    if (!spec) {
        throw new Error(`no spec: ${specId}`);
    }
    return specGroupIds(spec);
};

const sidebar = () => buildSpecSidebarGroups([], command => command);

/** The spec ids filed under a group, as the sidebar would show them. */
const commandsIn = (groupId: StoryCommandGroupId): string[] =>
    sidebar().find(entry => entry.group.id === groupId)?.commands.map(command => command.id) ?? [];

describe("accepts-driven classification (§4.2)", () => {
    it("files a generic verb under every subject it accepts - /show reaches all five", () => {
        expect(groupIds("show")).toEqual(["character", "image", "text", "video", "layer"]);
        expect(groupIds("hide")).toEqual(["character", "image", "text", "video", "layer"]);
        for (const group of ["character", "image", "text", "video", "layer"] as const) {
            expect(commandsIn(group)).toContain("show");
        }
    });

    it("does not file a verb under a subject it cannot act on", () => {
        // `/transform` writes a displayable payload: video and audio are not displayables, and the
        // sidebar must not offer it under them just because they are stage objects.
        expect(groupIds("transform")).toEqual(["image", "text", "layer", "character"]);
        expect(commandsIn("video")).not.toContain("transform");
        expect(commandsIn("sound")).not.toContain("transform");
        // The sound control family is the mirror case: audio only.
        expect(groupIds("volume")).toEqual(["sound"]);
        expect(commandsIn("image")).not.toContain("volume");
    });

    it("gives the layer subject the entries only the inspector used to reach (D4)", () => {
        expect(commandsIn("layer")).toEqual(expect.arrayContaining(["show", "hide", "transform", "fx", "layer"]));
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
        const listed = new Set(sidebar().flatMap(entry => entry.commands.map(command => command.id)));
        for (const spec of listCommandSpecs()) {
            expect(listed.has(spec.id)).toBe(true);
        }
    });
});

describe("the eight categories (§4.1, §12.3)", () => {
    it("cuts by exactly one criterion and keeps 舞台 as the only two-level category", () => {
        expect(STORY_COMMAND_CATEGORIES.map(category => category.id)).toEqual([
            "character", "stage", "camera", "scene", "sound", "data", "flow", "utils",
        ]);
        const multiLevel = STORY_COMMAND_CATEGORIES
            .filter(category => STORY_COMMAND_GROUPS.filter(group => group.category === category.id).length > 1)
            .map(category => category.id);
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
        const stageColors = STORY_COMMAND_GROUPS
            .filter(group => group.category === "stage")
            .map(group => group.iconColor);
        expect(new Set(stageColors).size).toBe(stageColors.length);
    });
});

/**
 * The exact hues, pinned - the assertion A1's "zero visual regression" promise actually rests on.
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
    utils: "#a8adb5",
};

const GROUP_COLORS: Record<StoryCommandGroupId, string> = {
    character: "var(--narraleaf-accent, #40a8c4)",
    image: "#96b8a0",
    text: "#9bb7d8",
    layer: "#92b9b0",
    video: "#b59dcc",
    camera: "#d1a176",
    scene: "#8fa9c7",
    sound: "#bd97a3",
    data: "#b8aa86",
    flow: "#b2a6c9",
    utils: "#a8adb5",
};

describe("pinned colours (§12.3)", () => {
    it("holds every group to the exact hue its rows already wear", () => {
        const actual = Object.fromEntries(STORY_COMMAND_GROUPS.map(group => [group.id, group.iconColor]));
        expect(actual).toEqual(GROUP_COLORS);
    });

    it("holds every category chip to the exact hue it browses under", () => {
        const actual = Object.fromEntries(STORY_COMMAND_CATEGORIES.map(category => [category.id, category.iconColor]));
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
