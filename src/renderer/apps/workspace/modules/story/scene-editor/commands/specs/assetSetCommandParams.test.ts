import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { storyNamesUnresolvedSet } from "@shared/build/assetSetMaterialization";
import { canCommit, parseCommandLine } from "../../storyCommandParser";
import { getCommandLineReason } from "../../storyCommandReason";
import { resolveCommandLine, type StoryCommandContext } from "../../storyCommandResolution";
import { EMPTY_STORY_COMMAND_CONTEXT } from "../../storyCommandResolution";
import { paramTypes } from "../../storyCommandGrammar";
import { getCommandSpec, listCommandDefs } from "../registry";

/**
 * Which command slots may name an asset set, and what saying so has to mean.
 *
 * The failure this exists to stop is not a crash: the inspector could write a set id into a row, the
 * row printed the set's name, and re-committing that very line reported "no image named …" - so a
 * word the author could read on the row was a word they could not type back, and any edit to the
 * rest of the line silently refused to commit.
 *
 * `allowSets` is what fixed it, and it is a claim about where the id ENDS UP: assembly resolves a
 * set only for the payload fields `assetIdSlots` lists. That claim is checked here against the
 * materializer's own reader (`storyNamesUnresolvedSet`) rather than against a copy of the list, so
 * the two cannot drift apart.
 */

const IMAGE_SET = "set_image";
const AUDIO_SET = "set_audio";
const VIDEO_SET = "set_video";

const CONTEXT: StoryCommandContext = {
    ...EMPTY_STORY_COMMAND_CONTEXT,
    images: [{ id: "i1", name: "forest_day" }],
    audio: [{ id: "a1", name: "theme" }],
    videos: [{ id: "v1", name: "intro" }],
    assetSets: [
        { id: IMAGE_SET, name: "Room", assetType: "image" },
        { id: AUDIO_SET, name: "Chime", assetType: "audio" },
        { id: VIDEO_SET, name: "Sting", assetType: "video" },
        // A font set: a real set the project holds, and one no command line can address. It is in
        // the list so a row naming it still reads as a name, never as an offer.
        { id: "set_font", name: "Serif", assetType: null },
    ],
    stageObjects: { ...EMPTY_STORY_COMMAND_CONTEXT.stageObjects, image: ["hero"], video: ["clip"] },
};

let nextId = 0;
const generateId = () => `id_${nextId++}`;

/** Parse → resolve → build, asserting the line commits. A refusal here IS the bug under test. */
function build(source: string): StoryBlock {
    const line = parseCommandLine(source);
    if (line.kind !== "command" || !line.def) {
        throw new Error(`not a command: ${source}`);
    }
    expect(canCommit(line), `${source} does not commit`).toBe(true);
    const { args, issues } = resolveCommandLine(line, CONTEXT);
    expect(issues, `${source} did not resolve`).toEqual([]);
    const spec = getCommandSpec(line.def.commandId);
    if (!spec?.build) {
        throw new Error(`no build on ${line.def.commandId}`);
    }
    return spec.build(args, { generateId, context: CONTEXT });
}

/**
 * Whether the build reaches assembly - asked through the materializer, which is the only thing whose
 * opinion decides whether the shipped game gets a file or an id nothing answers.
 */
function assemblyReadsSet(block: StoryBlock, setId: string): boolean {
    const document = {
        id: "story",
        name: "story",
        scenes: { s1: { id: "s1", name: "scene", blocks: { [block.id]: block }, rootBlockIds: [block.id] } },
    } as unknown as StoryDocument;
    return storyNamesUnresolvedSet({ story: document }, new Set([setId]));
}

describe("asset set command params", () => {
    it.each([
        ["/bg Room", IMAGE_SET],
        ["/image Room", IMAGE_SET],
        ["/video Sting", VIDEO_SET],
        ["/bgm Chime", AUDIO_SET],
        ["/sound Chime", AUDIO_SET],
        ["/vfx Sting", VIDEO_SET],
        // `/swap` types its content off the target. Only an image target reaches an asset today -
        // the verb accepts `image` and `text` - so the video arm of `resolveContent` is not exercised
        // here rather than asserted against a target the spec refuses.
        ["/swap hero Room", IMAGE_SET],
        // The mask is the one asset a row writes a level down (`transform.to.maskAssetId`), which is
        // exactly the slot the materializer had to be taught about - so it is worth proving here.
        ["/transform hero mask=Room", IMAGE_SET],
    ])("commits %s and hands the set id to assembly", (source, setId) => {
        expect(assemblyReadsSet(build(source), setId)).toBe(true);
    });

    /**
     * The transition's rule image is the slot that says no, and it says no for a reason that outlives
     * this test: it writes into the transition ref, which is not one of the fields the materializer
     * reads, so a set id there would reach the player as an id nothing answers.
     */
    it("refuses a set in the rule image, and says which library it looked in", () => {
        const line = parseCommandLine("/bg forest_day rule=Room");
        expect(line.kind).toBe("command");
        const { issues } = resolveCommandLine(line as never, CONTEXT);
        expect(issues.map(issue => issue.code)).toEqual(["unknownAsset"]);
        expect(getCommandLineReason("/bg forest_day rule=Room", CONTEXT)?.key)
            .toBe("storyExpr.reason.unknownAsset");
    });

    /** A slot that takes a set says so when the name matches nothing at all. */
    it("names both libraries when a set-legal slot cannot find the name", () => {
        expect(getCommandLineReason("/bg nosuchthing", CONTEXT)?.key)
            .toBe("storyExpr.reason.unknownAssetOrSet");
    });

    /** An image slot must not offer - or accept - a set whose members are audio. */
    it("keeps a set in the library its members come from", () => {
        const { issues } = resolveCommandLine(parseCommandLine("/bg Chime") as never, CONTEXT);
        expect(issues.map(issue => issue.code)).toEqual(["unknownAsset"]);
    });

    /**
     * Every asset slot in the registry, classified.
     *
     * A mirror of a table would be worth little on its own; what makes this one carry weight is the
     * case above, which proves each listed pair actually reaches assembly. Its job is to make a NEW
     * asset param a decision someone has to write down rather than a default.
     */
    it("classifies every asset slot in the registry", () => {
        const allowed: string[] = [];
        const refused: string[] = [];
        for (const def of listCommandDefs()) {
            for (const param of def.params) {
                for (const type of paramTypes(param)) {
                    if (type.kind !== "asset" && type.kind !== "content") {
                        continue;
                    }
                    (type.allowSets ? allowed : refused).push(`${def.commandId}.${param.name}`);
                }
            }
        }
        expect(allowed.sort()).toEqual([
            "background.image",
            "bgm.audio",
            "image.image",
            "sound.audio",
            "swap.content",
            "transform.mask",
            "vfx.clip",
            "video.video",
        ]);
        // The two rule-image slots - `/bg` and `/jump` both carry one - and nothing else.
        expect(refused.sort()).toEqual(["background.rule", "jump.rule"]);
    });
});
