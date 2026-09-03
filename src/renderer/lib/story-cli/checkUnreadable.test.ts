import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STORY_DOCUMENT_MIN_SUPPORTED_VERSION } from "@shared/story/migrateStoryDocument";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { runCli } from "./cli";

/**
 * `check` over a project holding a story the schema ladder refuses.
 *
 * Two things are being held to at once. The run does not stop - the stories that do open are still
 * checked, because a project of two stories one of which is too old is still a project with a
 * scene the author can fix. And the refusal is reported as `story/unreadable`, the id no rule owns:
 * it used to borrow `story/invalid-command`, which told an author their script held a bad row when
 * what happened was that Studio moved past the version their file is written at.
 */

const READABLE_ID = "11111111-1111-4111-8111-111111111111";
const ANCIENT_ID = "22222222-2222-4222-8222-222222222222";
const EMPTY_SCENE_ID = "33333333-3333-4333-8333-333333333333";

/** One below the floor, so the fixture stays honest if the floor moves. */
const ANCIENT_VERSION = STORY_DOCUMENT_MIN_SUPPORTED_VERSION - 1;

let projectDir: string;

function write(relative: string, contents: unknown): void {
    const absolute = path.join(projectDir, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, JSON.stringify(contents), "utf8");
}

async function check(): Promise<{ code: number; out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(["check", "--project", projectDir], {
        out: text => out.push(text),
        err: text => err.push(text),
    });
    return { code, out: out.join("\n"), err: err.join("\n") };
}

beforeAll(() => {
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-story-check-")));
    write("editor/story/index.json", {
        schemaVersion: 2,
        stories: [
            { id: READABLE_ID, name: "First Day" },
            { id: ANCIENT_ID, name: "Old Chapter" },
        ],
        defaultStoryId: READABLE_ID,
    });
    write(`editor/story/stories/${READABLE_ID}/storydoc.json`, {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: READABLE_ID,
        name: "First Day",
        entrySceneId: EMPTY_SCENE_ID,
        chapters: [{ id: "44444444-4444-4444-8444-444444444444", name: "Chapter 1", sceneIds: [EMPTY_SCENE_ID] }],
        scenes: {
            [EMPTY_SCENE_ID]: {
                id: EMPTY_SCENE_ID,
                name: "The corridor",
                runtimeName: "corridor",
                rootBlockIds: [],
                blocks: {},
            },
        },
    });
    write(`editor/story/stories/${ANCIENT_ID}/storydoc.json`, {
        schemaVersion: ANCIENT_VERSION,
        id: ANCIENT_ID,
        name: "Old Chapter",
        chapters: [],
        scenes: {},
    });
});

afterAll(() => {
    if (projectDir) {
        fs.rmSync(projectDir, { recursive: true, force: true });
    }
});

describe("story check over a document below the schema floor", () => {
    it("reports it under an id no rule owns, naming both versions", async () => {
        const result = await check();

        expect(result.out).toContain("story/unreadable");
        // The two numbers are the whole point of the message: without them an author reads their
        // own story's name beside a failure and looks for the mistake in their script.
        expect(result.out).toContain(`v${ANCIENT_VERSION}`);
        expect(result.out).toContain(`v${STORY_DOCUMENT_MIN_SUPPORTED_VERSION}`);
        expect(result.out).toContain("Old Chapter");

        // The id it used to borrow. Nothing about this document is a command the compiler refused.
        expect(result.out).not.toContain("story/invalid-command");
    });

    it("fails the run, and still checks the stories that do open", async () => {
        const result = await check();

        // An unreadable story is an error whatever the project configured, so the exit code is 1.
        expect(result.code).toBe(1);
        // The readable story was linted rather than abandoned along with its sibling.
        expect(result.out).toContain("story/empty-scene");
        expect(result.out).toContain("The corridor");
    });
});
