import { describe, expect, it } from "vitest";
import {
    STORY_COMMAND_CATEGORIES,
    STORY_COMMAND_GROUPS,
    getCommandGroup,
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
        expect(groupIds("stop")).toEqual(["sound"]);
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
