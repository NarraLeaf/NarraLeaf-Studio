import { describe, expect, it } from "vitest";
import { getCommandSpec } from "./commands/registry";
import { buildBehaviourBlockFromLine, CHARACTER_BEHAVIOUR_COMMAND_IDS } from "./storyBehaviourLine";
import { EMPTY_STORY_COMMAND_CONTEXT } from "./storyCommandValues";

describe("the commands a character behaviour offers", () => {
    it("names only commands that exist, so a rename cannot silently drop one from the menu", () => {
        for (const id of CHARACTER_BEHAVIOUR_COMMAND_IDS) {
            expect(getCommandSpec(id), id).not.toBeNull();
        }
    });

    it("refuses a finished command outside the list rather than writing its row", () => {
        expect(buildBehaviourBlockFromLine("/wait 1", EMPTY_STORY_COMMAND_CONTEXT)).toEqual({ ok: false, reason: "notAllowed" });
        expect(buildBehaviourBlockFromLine("/note hello", EMPTY_STORY_COMMAND_CONTEXT)).toEqual({ ok: false, reason: "notAllowed" });
    });

    it("builds a row from an allowed command", () => {
        const result = buildBehaviourBlockFromLine("/transform camera zoom=1.1", EMPTY_STORY_COMMAND_CONTEXT);
        expect(result.ok && result.block.payload).toMatchObject({ action: "camera" });
    });
});
