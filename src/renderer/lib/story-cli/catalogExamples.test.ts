import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { StoryDocument, StoryScene } from "@shared/types/story";
import { commandI18nStore } from "@/lib/i18n/commandLocale";
import { listCommandSpecs } from "@/apps/workspace/modules/story/scene-editor/commands/registry";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { Character } from "@/lib/workspace/services/character/Character";
import { applyStorySource, type StoryAgentContext } from "../agent-core/story";
import type { StoryLintStory } from "./check";
import { describeCommand } from "./catalog";
import { readProjectData, type ProjectData } from "./project";

/**
 * Every worked line the command catalogue prints - each command's `examples` and its `sequence` -
 * applied as a scene through the path `story_apply` takes: parse, compile, then the project lint over
 * the story with the scene in place. A line the catalogue teaches that the agent's own write refuses
 * is worse than no example, so any finding of `error` severity fails here.
 *
 * `specs.test.ts` already runs each example through parse → resolve → build, but against a context
 * where the stage holds whatever the line names. A scene does not: `/stop music` resolved there and
 * was refused here, because no row in the scene creates `music`. So each example is applied after a
 * short prelude that brings on the stage objects the examples address by name (`hero`, `title`,
 * `clip`, `petals`, `overlay`) - and nothing else. Anything an example names beyond those has to be
 * a real name in the project.
 *
 * The project is the shipped skeleton, with the fixture names the examples use added to it.
 */

const SKELETON = path.resolve(__dirname, "../../../../resources/templates/skeleton/content");

/** Rows that put on stage what the examples address by name, as an author would write them. */
const PRELUDE = [
    "/label intro",
    "/show Alice",
    "/image night name=hero",
    "/show hero",
    "/text name=title Hello",
    "/show title",
    "/layer overlay",
    "/play intro name=clip wait=false hide=false",
    "/vfx intro name=petals",
    "/show petals",
    "/bgm theme",
];

let counter = 0;
const nextId = (prefix: string) => `${prefix}-0000-4000-8000-${String(counter++).padStart(12, "0")}`;

function asset(type: AssetType, name: string): Asset {
    return { id: nextId("aaaaaaaa"), type, name, hash: name, source: "local", meta: {}, tags: [], description: "" } as unknown as Asset;
}

function emptyScene(id: string, name: string): StoryScene {
    return { id, name, rootBlockIds: [], blocks: {} } as unknown as StoryScene;
}

function fixture(): { context: StoryAgentContext; story: StoryLintStory; scene: StoryScene } {
    const data: ProjectData = readProjectData(SKELETON);
    const add = (type: AssetType, name: string) => {
        const made = asset(type, name);
        (data.assets as Record<string, Record<string, Asset>>)[type][made.id] = made;
    };
    for (const name of ["night", "forest_day", "spiral"]) add(AssetType.Image, name);
    for (const name of ["theme", "hit"]) add(AssetType.Audio, name);
    add(AssetType.Video, "intro");
    data.characters.push(Character.fromJSON({
        profile: {
            id: nextId("cccccccc"), name: "Alice", nicknames: [], tags: [], description: "", attributes: {}, thumbnail: null,
            appearance: {
                kind: "preset",
                defaultPoseId: "smile",
                poses: [{ id: "smile", name: "smile", assetId: null }, { id: "angry", name: "angry", assetId: null }],
            },
        },
    } as never));
    data.characters.push(Character.fromJSON({
        profile: {
            id: nextId("dddddddd"), name: "Doll", nicknames: [], tags: [], description: "", attributes: {}, thumbnail: null,
            appearance: { kind: "puppet", assetId: null, backend: "", size: { width: 1000, height: 1600 } },
        },
    } as never));
    data.savedVariables.push(
        { id: "var_gold", storageKey: "var_gold", name: "gold", scope: "saved", valueType: "number", defaultValue: 10 } as never,
        { id: "var_met", storageKey: "var_met", name: "met", scope: "saved", valueType: "boolean" } as never,
    );
    // Only what the skeleton lacks: a second "Title" page would make the name ambiguous.
    const ensure = (list: { id: string; name: string }[], id: string, name: string) => {
        if (!list.some(entry => entry.name === name)) list.push({ id, name });
    };
    ensure(data.appTags, "demo", "Demo");
    ensure(data.surfaces, "surface_map", "Map");
    ensure(data.surfaces, "surface_title", "Title");
    ensure(data.inputActions, "act_confirm", "Confirm");

    const storiesDir = path.join(SKELETON, "editor", "story", "stories");
    const storyId = fs.readdirSync(storiesDir)[0];
    const stored = JSON.parse(fs.readFileSync(path.join(storiesDir, storyId, "storydoc.json"), "utf8")) as StoryDocument;
    const scene = emptyScene(nextId("eeeeeeee"), "Examples");
    const next = emptyScene(nextId("ffffffff"), "Chapter 2");
    const document: StoryDocument = { ...stored, scenes: { ...stored.scenes, [scene.id]: scene, [next.id]: next } };
    const story: StoryLintStory = { id: storyId, name: "Skeleton", document };
    return { context: { data, stories: [story] }, story, scene };
}

/**
 * What the editor scaffolds under a row as it commits, and a file has to write out: a condition's
 * branch, a choice's options. The single-line example states the row; this is the body under it.
 */
const SCAFFOLD_BODY: Record<string, readonly string[]> = {
    condition: ["  Something happens."],
    choice: ["  - Yes", "    Something happens.", "  - No", "    Nothing happens."],
};

/** The lines the catalogue prints for a command, each a scene's worth: one per example, one for the sequence. */
function workedLines(token: string): { label: string; lines: string[] }[] {
    const detail = describeCommand(token);
    if (!detail) {
        return [];
    }
    const body = detail.scaffold ? SCAFFOLD_BODY[detail.scaffold] ?? [] : [];
    return [
        ...detail.examples.map(example => ({ label: example, lines: [example, ...body] })),
        ...(detail.sequence ? [{ label: detail.sequence.lines.join(" | "), lines: [...detail.sequence.lines] }] : []),
    ];
}

describe("the command catalogue's worked lines", () => {
    // The catalogue prints the canonical tokens, which is what story_command pins too.
    commandI18nStore.setPreference(false);
    const { context, story, scene } = fixture();

    it("covers every command", () => {
        const tokens = listCommandSpecs().map(spec => spec.token);
        expect(tokens.length).toBeGreaterThan(40);
        expect(tokens.filter(token => workedLines(token).length === 0)).toEqual([]);
    });

    it("applies the prelude cleanly on its own", async () => {
        const source = `#nlstory 1\n#scene ${scene.name} ⟦${scene.id}⟧\n\n${PRELUDE.join("\n")}\n`;
        const result = await applyStorySource(source, context, story);
        expect(result.err.concat(result.out).join("\n")).not.toMatch(/\berror\b/i);
        expect(result.exitCode).toBe(0);
    });

    for (const spec of listCommandSpecs()) {
        for (const { label, lines } of workedLines(spec.token)) {
            it(`/${spec.token}: ${label}`, async () => {
                const source = `#nlstory 1\n#scene ${scene.name} ⟦${scene.id}⟧\n\n${[...PRELUDE, ...lines].join("\n")}\n`;
                const result = await applyStorySource(source, context, story);
                const errors = [
                    ...result.check.fileDiagnostics,
                    ...result.check.projectFindings.map(finding => finding.diagnostic),
                ].filter(diagnostic => diagnostic.severity === "error");
                expect(errors.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`), result.out.join("\n")).toEqual([]);
                expect(result.exitCode, result.out.concat(result.err).join("\n")).toBe(0);
            });
        }
    }
});
