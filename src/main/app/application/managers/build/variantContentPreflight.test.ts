import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_TAG_SCHEMA_VERSION, type ProjectAppTagDocument } from "@shared/types/appTag";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryBlock, type StoryDocument } from "@shared/types/story";
import { collectVariantContentFindings } from "./variantContentPreflight";

/**
 * The three things a variant's cut points can be wrong about, judged from disk.
 *
 * The release build is the case that has to stay free: it honours no cut point, so it reads no story
 * document at all - which is what keeps this check off the path almost every build takes.
 */

const DEMO_ID = "tag-demo";
/** A real UUID v4: the story reader refuses any id that is not one, exactly as the packer does. */
const STORY_ID = "6f1b5c2e-4d3a-4a71-9c88-0b2e5a7d1f04";

let tempDir: string;

beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-variant-preflight-"));
});

afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
});

function line(id: string): StoryBlock {
    return {
        id,
        parentId: null,
        childrenIds: [],
        kind: "nodeAction",
        payload: { action: "narration", text: { textId: `text-${id}`, value: id, role: "narration" } },
    } as StoryBlock;
}

function cut(id: string, appTagId = DEMO_ID): StoryBlock {
    return { id, parentId: null, childrenIds: [], kind: "control", payload: { control: "cut", appTagId } } as StoryBlock;
}

function jump(id: string, targetSceneId: string): StoryBlock {
    return { id, parentId: null, childrenIds: [], kind: "jump", payload: { targetSceneId } } as StoryBlock;
}

function storyDocument(scenes: { id: string; blocks: StoryBlock[] }[]): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: STORY_ID,
        name: "Main Story",
        chapters: [{ id: "chapter-1", name: "Chapter 1", sceneIds: scenes.map(entry => entry.id) }],
        entrySceneId: scenes[0]?.id,
        scenes: Object.fromEntries(scenes.map(entry => [entry.id, {
            id: entry.id,
            name: entry.id,
            runtimeName: entry.id,
            rootBlockIds: entry.blocks.map(block => block.id),
            blocks: Object.fromEntries(entry.blocks.map(block => [block.id, block])),
        }])),
    };
}

async function writeStory(document: StoryDocument): Promise<void> {
    const storyDir = path.join(tempDir, "editor", "story", "stories", document.id);
    await fs.mkdir(storyDir, { recursive: true });
    await fs.writeFile(
        path.join(tempDir, "editor", "story", "index.json"),
        JSON.stringify({ stories: [{ id: document.id, name: document.name }] }),
        "utf-8",
    );
    await fs.writeFile(path.join(storyDir, "storydoc.json"), JSON.stringify(document), "utf-8");
}

function tagDocument(overrides?: Partial<ProjectAppTagDocument>): ProjectAppTagDocument {
    return {
        schemaVersion: APP_TAG_SCHEMA_VERSION,
        tags: [{ id: DEMO_ID, name: "Demo", overrides: {} }],
        ...overrides,
    };
}

async function run(appTagId: string | undefined, document?: ProjectAppTagDocument) {
    return collectVariantContentFindings({
        projectPath: tempDir,
        appTagId,
        appTagDocument: document ?? tagDocument(),
    });
}

describe("collectVariantContentFindings", () => {
    it("reports a cut point that would take nothing with it", async () => {
        await writeStory(storyDocument([{ id: "s1", blocks: [line("a"), cut("c")] }]));

        const findings = await run(DEMO_ID);

        expect(findings).toContainEqual({
            code: "cut-point-inert",
            severity: "error",
            section: "content",
            detail: { variant: "Demo", story: "Main Story", scene: "s1" },
        });
    });

    it("says nothing about a cut point that ends the scene early", async () => {
        await writeStory(storyDocument([{ id: "s1", blocks: [line("a"), cut("c"), line("b")] }]));

        expect((await run(DEMO_ID, tagDocument({ endingSurfaceId: "surface-credits" }))))
            .toEqual([]);
    });

    it("refuses a variant that shortens the story with nowhere to land", async () => {
        await writeStory(storyDocument([{ id: "s1", blocks: [line("a"), cut("c"), line("b")] }]));

        expect(await run(DEMO_ID)).toEqual([{
            code: "variant-ending-missing",
            severity: "error",
            section: "content",
            detail: { variant: "Demo" },
        }]);
    });

    it("takes a variant's own 'show nothing' as an answer", async () => {
        await writeStory(storyDocument([{ id: "s1", blocks: [line("a"), cut("c"), line("b")] }]));

        const document = tagDocument({
            tags: [{ id: DEMO_ID, name: "Demo", overrides: {}, endingSurfaceId: "" }],
        });

        expect(await run(DEMO_ID, document)).toEqual([]);
    });

    it("warns, and does not refuse, when one route ends and another carries on", async () => {
        await writeStory(storyDocument([
            { id: "s1", blocks: [jump("j1", "s2"), jump("j2", "s3")] },
            { id: "s2", blocks: [line("a"), cut("c"), line("b")] },
            { id: "s3", blocks: [line("d")] },
        ]));

        const findings = await run(DEMO_ID, tagDocument({ endingSurfaceId: "surface-credits" }));

        expect(findings).toEqual([{
            code: "variant-branch-uncut",
            severity: "warning",
            section: "content",
            detail: { variant: "Demo", story: "Main Story", scene: "s1" },
        }]);
    });

    it("says nothing at all about the release variant, and reads no story to say it", async () => {
        // No story files written: reaching for one would throw or answer, and either would mean the
        // release build is paying for a check that cannot apply to it.
        expect(await run(undefined)).toEqual([]);
    });

    it("says nothing about a project with no stories", async () => {
        expect(await run(DEMO_ID)).toEqual([]);
    });
});
