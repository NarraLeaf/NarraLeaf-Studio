import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument, StoryRichRun, StoryScene } from "@shared/types/story";
import { commandI18nStore } from "@/lib/i18n/commandLocale";
import { compileStoryFile } from "./dsl/compile";
import { sameRowContent } from "./dsl/equal";
import { parseStoryFile } from "./dsl/parse";
import { printStoryScene } from "./dsl/print";
import { buildLookups } from "./lookups";
import { buildContext, readProjectData, type ProjectData } from "./project";

/**
 * Inline events in a `.story` line: `{char <look> fade=<s> sound=<audio>}` and `{sound <audio>}`.
 *
 * Against the shipped skeleton, whose Narra has one pose, "Default", and whose audio holds
 * "ui-confirm" - a real project, so the look is resolved by the same `/char` path a row takes.
 */

const SKELETON = path.resolve(__dirname, "../../../../resources/templates/skeleton/content");
const NARRA = "77eb07ac-4af6-48c0-80c1-7db3de78a9ce";
const POSE = "p1oh";
const CONFIRM = "e54ece05-7e8c-4196-85b2-57a356b8e442";

function project(): { data: ProjectData; document: StoryDocument; scene: StoryScene } {
    const storiesDir = path.join(SKELETON, "editor", "story", "stories");
    const storyId = fs.readdirSync(storiesDir)[0];
    const document = JSON.parse(fs.readFileSync(path.join(storiesDir, storyId, "storydoc.json"), "utf8")) as StoryDocument;
    const scene = (Object.values(document.scenes) as StoryScene[]).find(entry => entry.name === "The corridor")!;
    return { data: readProjectData(SKELETON), document, scene };
}

function firstRow(scene: StoryScene, action: "dialogue" | "narration"): StoryBlock {
    return scene.rootBlockIds.map(id => scene.blocks[id]).find(block =>
        block.kind === "nodeAction" && block.payload.action === action
        && (action === "narration" || (block.payload as { characterId?: string }).characterId === NARRA))!;
}

/** `scene` with `block`'s words replaced by `rich`. */
function withRuns(scene: StoryScene, block: StoryBlock, rich: StoryRichRun[]): StoryScene {
    const payload = block.payload as { text: { value: string } };
    const value = rich.map(run => ("text" in run ? run.text : "")).join("");
    return {
        ...scene,
        blocks: {
            ...scene.blocks,
            [block.id]: { ...block, payload: { ...block.payload, text: { ...payload.text, value, rich } } } as StoryBlock,
        },
    };
}

let minted = 0;

function setup(data: ProjectData, document: StoryDocument, scene: StoryScene) {
    const context = buildContext(data, document, scene);
    const lookups = buildLookups(data, document, scene, context);
    return { context, lookups };
}

function print(data: ProjectData, document: StoryDocument, scene: StoryScene) {
    const { context, lookups } = setup(data, document, scene);
    return printStoryScene({
        scene,
        storyName: "test",
        context,
        rowLookups: lookups.rowLookups,
        prose: lookups.prose,
        conditions: lookups.conditions,
    });
}

function compile(data: ProjectData, document: StoryDocument, scene: StoryScene, text: string) {
    const { lookups } = setup(data, document, scene);
    const parsed = parseStoryFile(text);
    return compileStoryFile({
        ast: parsed.ast,
        existing: scene,
        document,
        contextFor: next => buildContext(data, document, next ?? scene),
        prose: lookups.prose,
        conditions: lookups.conditions,
        mintId: () => `MINTED-${minted++}`,
    });
}

describe("inline events in a .story line", () => {
    commandI18nStore.setPreference(false);
    const { data, document, scene } = project();
    const line = firstRow(scene, "dialogue");
    const narration = firstRow(scene, "narration");

    function roundTrips(edited: StoryScene) {
        const printed = print(data, document, edited);
        const compiled = compile(data, document, edited, printed.text);
        expect(compiled.diagnostics).toEqual([]);
        for (const [id, block] of Object.entries(edited.blocks)) {
            expect(sameRowContent(compiled.scene!.blocks[id], block), `row ${id}`).toBe(true);
        }
        return printed;
    }

    it("spells an expression change with its fade and sound, and reads it back", () => {
        const edited = withRuns(scene, line, [
            { text: "You're " },
            { event: { expression: { characterId: NARRA, pose: POSE, fadeMs: 200 }, sound: { assetId: CONFIRM } } },
            { text: "late." },
        ]);
        const printed = roundTrips(edited);
        expect(printed.text).toContain("Narra: You're {char Default fade=0.2 sound=ui-confirm}late.");
        expect(printed.stats.opaque).toBe(print(data, document, scene).stats.opaque);
    });

    it("leaves fade= off a change that inherits, and writes fade=0 for one that turns it off", () => {
        const edited = withRuns(scene, line, [
            { text: "A" },
            { event: { expression: { characterId: NARRA, pose: POSE } } },
            { text: "B" },
            { event: { expression: { characterId: NARRA, pose: POSE, fadeMs: 0 } } },
            { text: "C" },
        ]);
        expect(roundTrips(edited).text).toContain("Narra: A{char Default}B{char Default fade=0}C");
    });

    it("keeps styling open across an event", () => {
        const edited = withRuns(scene, line, [
            { text: "so ", marks: { bold: true } },
            { event: { expression: { characterId: NARRA, pose: POSE } } },
            { text: "late", marks: { bold: true } },
        ]);
        expect(roundTrips(edited).text).toContain("Narra: {b}so {char Default}late{/b}");
    });

    it("spells a sound alone, in narration too", () => {
        const edited = withRuns(scene, narration, [{ text: "A door " }, { event: { sound: { assetId: CONFIRM } } }, { text: "slams." }]);
        expect(roundTrips(edited).text).toContain("A door {sound ui-confirm}slams.");
    });

    it("reads a typed {char …} into the event an editor would have made", () => {
        const printed = print(data, document, scene).text;
        const edited = printed.replace("Narra: You're late.", "Narra: You're {char default fade=0.5s}late.");
        expect(edited).not.toBe(printed);
        const compiled = compile(data, document, scene, edited);
        expect(compiled.diagnostics).toEqual([]);
        const rich = (compiled.scene!.blocks[line.id].payload as { text: { value: string; rich?: StoryRichRun[] } }).text;
        expect(rich.value).toBe("You're late.");
        expect(rich.rich).toEqual([
            { text: "You're " },
            { event: { expression: { characterId: NARRA, pose: POSE, fadeMs: 500 } } },
            { text: "late." },
        ]);
    });

    it("writes a literal tag shape escaped, and reads it back as text", () => {
        // A plain segment, as Studio stores unstyled words (a lone unmarked run reads back without
        // `rich`, so it never echoes - that is older than inline events and not what is tested here).
        const payload = line.payload as { text: object };
        const edited: StoryScene = {
            ...scene,
            blocks: {
                ...scene.blocks,
                [line.id]: { ...line, payload: { ...line.payload, text: { ...payload.text, value: "Type {char sad} to frown.", rich: undefined } } } as StoryBlock,
            },
        };
        delete ((edited.blocks[line.id].payload as { text: { rich?: unknown } }).text).rich;
        expect(roundTrips(edited).text).toContain("Narra: Type \\{char sad} to frown.");
    });

    function refusal(replacement: string): string {
        const printed = print(data, document, scene).text;
        const compiled = compile(data, document, scene, printed.replace("Narra: You're late.", replacement));
        return compiled.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n");
    }

    it("refuses a look the speaker does not have, as the /char row would", () => {
        expect(refusal("Narra: You're {char grinning}late.")).toMatch(/compile\.inlineMarkup:.*grinning/);
    });

    it("refuses a {char …} with no character to change", () => {
        expect(refusal("You're {char Default}late.")).toMatch(/needs a dialogue line spoken by a character/);
        expect(refusal("Stranger: You're {char Default}late.")).toMatch(/needs a dialogue line spoken by a character/);
    });

    it("refuses a fade that is not seconds, and a sound the project does not have", () => {
        expect(refusal("Narra: You're {char Default fade=soon}late.")).toMatch(/not a number of seconds/);
        expect(refusal("Narra: You're {char Default sound=boom}late.")).toMatch(/no audio asset is called "boom"/);
        expect(refusal("Narra: You're {sound boom}late.")).toMatch(/no audio asset is called "boom"/);
    });

    it("refuses what belongs on a /char row rather than inline", () => {
        expect(refusal("Narra: You're {char Default d=0.4}late.")).toMatch(/takes the look only|compile\.inlineMarkup/);
    });
});
