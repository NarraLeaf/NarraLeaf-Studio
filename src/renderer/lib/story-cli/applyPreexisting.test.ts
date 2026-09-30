import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryDocument } from "@shared/types/story";
import { runCli } from "./cli";

/**
 * `apply` over a project that already had a lint error somewhere else.
 *
 * The document layer reads the whole project, so a project with one bad row in a scene nobody is
 * editing used to be a project nothing could be written into at all: every `apply`, anywhere, was
 * refused by a finding it had not caused. The linter is now run twice - before the edit and after -
 * and only the difference answers for the write.
 *
 * The fixture is two scenes: one holding a choice with no options, which `story/empty-choice`
 * reports at error severity and which nothing here ever fixes, and one empty scene to write into.
 */

const STORY_ID = "11111111-1111-4111-8111-111111111111";
const CHAPTER_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_SCENE_ID = "33333333-3333-4333-8333-333333333333";
const BROKEN_SCENE_ID = "44444444-4444-4444-8444-444444444444";
const BROKEN_CHOICE_ID = "55555555-5555-4555-8555-555555555555";

let projectDir: string;

function write(relative: string, contents: unknown): void {
    const absolute = path.join(projectDir, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, JSON.stringify(contents), "utf8");
}

function storyFile(rows: string): string {
    const file = path.join(projectDir, "scene.story");
    fs.writeFileSync(
        file,
        `#nlstory 1\n#story First Day\n#scene The corridor ⟦${TARGET_SCENE_ID}⟧\n\n${rows}\n`,
        "utf8",
    );
    return file;
}

async function apply(file: string): Promise<{ code: number; out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(["apply", file, "--project", projectDir, "--write"], {
        out: text => out.push(text),
        err: text => err.push(text),
    });
    return { code, out: out.join("\n"), err: err.join("\n") };
}

function targetScene(): { rootBlockIds: string[]; blocks: Record<string, unknown> } {
    const file = path.join(projectDir, "editor/story/stories", STORY_ID, "storydoc.json");
    const document = JSON.parse(fs.readFileSync(file, "utf8")) as StoryDocument;
    return document.scenes[TARGET_SCENE_ID] as never;
}

beforeEach(() => {
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-story-apply-")));
    write("editor/story/index.json", {
        schemaVersion: 2,
        stories: [{ id: STORY_ID, name: "First Day" }],
        defaultStoryId: STORY_ID,
    });
    write(`editor/story/stories/${STORY_ID}/storydoc.json`, {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: STORY_ID,
        name: "First Day",
        entrySceneId: TARGET_SCENE_ID,
        chapters: [{ id: CHAPTER_ID, name: "Chapter 1", sceneIds: [TARGET_SCENE_ID, BROKEN_SCENE_ID] }],
        scenes: {
            [TARGET_SCENE_ID]: {
                id: TARGET_SCENE_ID,
                name: "The corridor",
                runtimeName: "corridor",
                rootBlockIds: [],
                blocks: {},
            },
            [BROKEN_SCENE_ID]: {
                id: BROKEN_SCENE_ID,
                name: "Chapter three",
                runtimeName: "chapter-three",
                rootBlockIds: [BROKEN_CHOICE_ID],
                blocks: {
                    [BROKEN_CHOICE_ID]: {
                        id: BROKEN_CHOICE_ID,
                        parentId: null,
                        childrenIds: [],
                        kind: "nodeAction",
                        payload: {
                            action: "choice",
                            text: { textId: "66666666-6666-4666-8666-666666666666", role: "choice", value: "Which way?" },
                        },
                    },
                },
            },
        },
    });
});

afterEach(() => {
    if (projectDir) {
        fs.rmSync(projectDir, { recursive: true, force: true });
    }
});

describe("story apply into a project that already has an error", () => {
    it("writes the scene, and says the project's own finding was left where it was", async () => {
        const result = await apply(storyFile("The last bell rang twenty minutes ago."));

        expect(result.code).toBe(0);
        expect(result.out).toContain("Written.");
        expect(targetScene().rootBlockIds).toHaveLength(1);
        // The error in the other scene is counted, not listed: it is not this file's doing, and
        // printing it beside a write it did not stop would read as a refusal.
        expect(result.out).toMatch(/findings? (was|were) already in this project/);
        expect(result.out).not.toContain("story/empty-choice");
    });

    it("still refuses a file that adds an error of its own, and names it", async () => {
        const result = await apply(storyFile("The last bell rang twenty minutes ago.\n/menu Which way?"));

        expect(result.code).toBe(1);
        expect(result.err).toContain("Nothing written.");
        expect(result.out).toContain("story/empty-choice");
        // Named at the row the file put it on, in the scene being written - not the fixture's.
        expect(result.out).toContain("The corridor");
        expect(result.out).not.toContain("Chapter three");
        // The refusal is a refusal: the document on disk still has no rows.
        expect(targetScene().rootBlockIds).toHaveLength(0);
    });

    it("counts a second finding of the same rule at a new site as new", async () => {
        // Two empty choices in the edited scene against one in the project: keys alone would call
        // this "seen before", and the count is what makes the second one visible.
        const result = await apply(storyFile("/menu Which way?\n/menu Or which way?"));

        expect(result.code).toBe(1);
        expect(result.out.match(/story\/empty-choice/g)).toHaveLength(2);
    });
});
