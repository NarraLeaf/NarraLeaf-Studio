import { describe, expect, it } from "vitest";
import type { StoryActionPayload } from "@shared/types/story";
import { storyVerbCommandId, storyVerbLabelKey } from "@/lib/story/storyVerbVocabulary";
import { getCommandSpec, listCommandSpecs } from "./commands/registry";

/**
 * The guard `storyVerbVocabulary` cannot hold itself.
 *
 * That module states which command names each payload's verb, and deliberately does not import the
 * command registry — `lib/story` is the projection layer the Dev Mode timeline reuses, and it should
 * not drag 45 specs in to print a sentence. The dependency lives here instead, in a test that may
 * reach both sides: the table stays honest, and the layering stays clean.
 */

const payload = (value: unknown): StoryActionPayload => value as StoryActionPayload;

describe("storyVerbVocabulary", () => {
    it("names only commands that actually exist", () => {
        // Every id in the table has to resolve, or the row renders a `story.command.<typo>.label` key
        // as its verb — a failure that looks like a missing translation and hides for a long time.
        const operations: Array<[StoryActionPayload["action"], readonly string[]]> = [
            ["character", ["enter", "exit", "move", "expression", "setName", "setMotion", "setSkin", "setParams"]],
            ["image", ["create", "setSource", "show", "hide"]],
            ["text", ["create", "setText", "show", "hide", "setFontSize", "setFontColor"]],
            ["layer", ["create", "setZIndex", "show", "hide", "transform"]],
            ["video", ["create", "show", "hide", "play", "pause", "resume", "stop", "seek"]],
            ["vfx", ["create", "show", "hide", "pause", "resume", "setRate"]],
            ["audio", ["setBgm", "playSound", "stopSound", "pauseSound", "resumeSound", "setVolume", "setRate", "seekSound"]],
            ["displayable", ["show", "hide", "transform"]],
        ];
        const unknown: string[] = [];
        for (const [action, ops] of operations) {
            for (const operation of ops) {
                const id = storyVerbCommandId(payload({ action, operation }));
                expect(id, `${action}.${operation} names no command`).not.toBeNull();
                if (id !== null && !getCommandSpec(id)) {
                    unknown.push(`${action}.${operation} -> ${id}`);
                }
            }
        }
        expect(unknown).toEqual([]);
    });

    it("names the verb-carrying payloads that own no operation", () => {
        for (const action of ["setBackground", "wait", "nvl", "camera", "setVariable"] as const) {
            const id = storyVerbCommandId(payload({ action }));
            expect(id, `${action} names no command`).not.toBeNull();
            expect(getCommandSpec(id!), `${action} -> ${id} is not a spec`).toBeTruthy();
        }
    });

    it("reads the generic verbs back as one word across every target they dispatch to", () => {
        // Bible B3: the author remembers `/show` and `/hide`, not "enter" and "imageShow". The row has
        // to agree, or the manual teaches one word and the finished script shows another.
        for (const action of ["character", "image", "text", "video", "layer", "vfx", "displayable"] as const) {
            const show = action === "character" ? "enter" : "show";
            const hide = action === "character" ? "exit" : "hide";
            expect(storyVerbCommandId(payload({ action, operation: show })), action).toBe("show");
            expect(storyVerbCommandId(payload({ action, operation: hide })), action).toBe("hide");
        }
    });

    it("splits mute from unmute on the flag, since one payload carries both verbs", () => {
        expect(storyVerbCommandId(payload({ action: "audio", operation: "muteSound", muted: true }))).toBe("mute");
        expect(storyVerbCommandId(payload({ action: "audio", operation: "muteSound", muted: false }))).toBe("unmute");
        // A row that never stored the flag is a mute; that is the operation's own default.
        expect(storyVerbCommandId(payload({ action: "audio", operation: "muteSound" }))).toBe("mute");
    });

    it("says nothing for the inspector-only displayable operations", () => {
        for (const operation of ["mask", "clearMask", "clip", "filter", "backdrop", "blend"]) {
            expect(storyVerbCommandId(payload({ action: "displayable", operation })), operation).toBeNull();
        }
    });

    it("builds the same key namespace the action creator reads", () => {
        // The whole point of the table: one string, read by the menu, the manual and the row alike.
        const hide = listCommandSpecs().find(spec => spec.id === "hide");
        expect(hide).toBeTruthy();
        expect(storyVerbLabelKey(payload({ action: "character", operation: "exit" }))).toBe("story.command.hide.label");
    });
});
