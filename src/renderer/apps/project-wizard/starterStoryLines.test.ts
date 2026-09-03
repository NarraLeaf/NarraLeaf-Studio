/**
 * The starter template's rows read back as the lines that would produce them.
 *
 * A new project's first scenes are the first thing an author reads, and every row in them is a row
 * they will click into. So the template is held to the property the row editor promises everywhere
 * else: the line a row prints, parsed back, is the row. A template row that prints a line missing
 * half its payload teaches the line's spelling wrong from the first minute.
 *
 * The rule this file was written for is the sharper half of that: a character's entrance and exit
 * animate through their TRANSFORM, and the engine never reads the `StoryTransitionRef` beside it
 * (`storyCompiler`'s character arm passes `payload.transform` to `hide`, and only a portrait swap
 * reaches `createTransition`). A template row that stated its 600 ms fade-out as a transition
 * therefore played a 250 ms default instead, printed as a bare `/hide Narra`, and showed nothing in
 * the inspector - three surfaces disagreeing about one row.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { buildLookups } from "@/lib/story-cli/lookups";
import { buildContext, listStories, readProjectData, readStoryDocument } from "@/lib/story-cli/project";
import { getCommandSpec } from "@/apps/workspace/modules/story/scene-editor/commands/registry";
import { parseCommandLine } from "@/apps/workspace/modules/story/scene-editor/storyCommandParser";
import { resolveCommandLine } from "@/apps/workspace/modules/story/scene-editor/storyCommandResolution";
import { projectStoryCommandLine } from "@/apps/workspace/modules/story/scene-editor/storyCommandLine";

const TEMPLATE_DIR = path.resolve(__dirname, "../../../../resources/templates/skeleton/content");

const data = readProjectData(TEMPLATE_DIR);
const documents: StoryDocument[] = listStories(TEMPLATE_DIR).map(summary => readStoryDocument(TEMPLATE_DIR, summary.id).document);

/** Every action row in the template, with the scene it lives in - the unit both tests below sweep. */
function rows(): { document: StoryDocument; sceneId: string; block: StoryBlock }[] {
    const out: { document: StoryDocument; sceneId: string; block: StoryBlock }[] = [];
    for (const document of documents) {
        for (const scene of Object.values(document.scenes)) {
            for (const block of Object.values(scene.blocks)) {
                out.push({ document, sceneId: scene.id, block });
            }
        }
    }
    return out;
}

/** Parse → resolve → build: the path Enter takes, run over a line the projection wrote. */
function rebuild(document: StoryDocument, sceneId: string, source: string): StoryBlock["payload"] {
    const scene = document.scenes[sceneId];
    const line = parseCommandLine(source);
    expect(line.kind, source).toBe("command");
    if (line.kind !== "command" || !line.def) {
        throw new Error(`not a command: ${source}`);
    }
    expect(line.issues, source).toEqual([]);
    const context = buildContext(data, document, scene);
    const { args, issues } = resolveCommandLine(line, context);
    expect(issues, source).toEqual([]);
    const spec = getCommandSpec(line.def.commandId);
    if (!spec?.build) {
        throw new Error(`no build on ${line.def.commandId}`);
    }
    return spec.build(args, { generateId: () => "rebuilt", context }).payload;
}

describe("the starter template's character rows", () => {
    it("state their entrance and exit as a transform, which is the field the engine plays", () => {
        // Not "the template happens to have none": a transition on one of these rows is data no
        // surface reads, and the row would go on claiming a timing nothing honours.
        const stale = rows().filter(({ block }) =>
            block.kind === "action"
            && block.payload.action === "character"
            && (block.payload.operation === "enter" || block.payload.operation === "exit")
            && block.payload.transition !== undefined);

        expect(stale.map(({ block }) => block.id)).toEqual([]);
    });

    it("prints Narra's exit with the fade it plays, and takes the line back unchanged", () => {
        // The row the rule above was written for. Named rather than swept, because what is being
        // pinned is that this particular 600 ms fade-out survives the trip - a sweep that found no
        // `/hide` row at all would pass while saying nothing.
        const found = rows().find(({ block }) =>
            block.kind === "action"
            && block.payload.action === "character"
            && block.payload.operation === "exit");
        expect(found, "the template still has a character exit row").toBeTruthy();
        const { document, sceneId, block } = found!;

        const scene = document.scenes[sceneId];
        const line = projectStoryCommandLine(block, {
            ...buildLookups(data, document, scene, buildContext(data, document, scene)).rowLookups,
        });

        expect(line?.source).toBe("/hide Narra out=fade d=0.6s");
        expect(rebuild(document, sceneId, line!.source)).toEqual(block.payload);
    });
});
