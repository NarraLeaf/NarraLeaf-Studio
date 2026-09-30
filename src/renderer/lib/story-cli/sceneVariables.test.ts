import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryBlock, type StoryDocument } from "@shared/types/story";
import { runCli } from "./cli";

/**
 * A `/local` line: declaring a scene variable from a file, and reading one back.
 *
 * A declaration is a row (schema v6) - the row IS the variable, its id is the id every `/set` and
 * every condition refers to it by, and its `storageKey` is the key a save file files its value
 * under. So three things have to hold, and each of them failed before:
 *
 *  - **A line is not its own duplicate.** The compiler resolves every line against a scene that
 *    already holds the row the line stands for - the stored one for a line with an anchor, the first
 *    pass's for a new one - and a declaration checked against that scene found itself.
 *  - **A row that names a new row names the id it ends up with.** The two passes used to mint new
 *    rows afresh each time, so a `/set hp` resolved in the second pass pointed at the id the FIRST
 *    pass gave `hp`, which is in no scene at all.
 *  - **A stored declaration prints as the line that declares it**, and that line reads back as the
 *    same row, storage key included.
 *
 * End to end through `runCli`, over a project on disk, because the property is about what lands in
 * `storydoc.json` and what `show` prints from it - not about any one function.
 */

const STORY_ID = "11111111-1111-4111-8111-111111111111";
const CHAPTER_ID = "22222222-2222-4222-8222-222222222222";
const SCENE_ID = "33333333-3333-4333-8333-333333333333";
const STORED_HP_ID = "44444444-4444-4444-8444-444444444444";
const STORED_MP_ID = "55555555-5555-4555-8555-555555555555";
const STORED_SECOND_HP_ID = "66666666-6666-4666-8666-666666666666";

let projectDir: string;

function write(relative: string, contents: unknown): void {
    const absolute = path.join(projectDir, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, JSON.stringify(contents, null, 2), "utf8");
}

const storyDocPath = (): string => path.join(projectDir, "editor/story/stories", STORY_ID, "storydoc.json");

function declaration(id: string, name: string, extra: Record<string, unknown> = {}): StoryBlock {
    return {
        id,
        kind: "declaration",
        parentId: null,
        childrenIds: [],
        payload: { scope: "scene", name, valueType: "number", defaultValue: 5, storageKey: id, ...extra },
    } as StoryBlock;
}

function writeScene(blocks: StoryBlock[]): void {
    write(`editor/story/stories/${STORY_ID}/storydoc.json`, {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: STORY_ID,
        name: "First Day",
        entrySceneId: SCENE_ID,
        chapters: [{ id: CHAPTER_ID, name: "Chapter 1", sceneIds: [SCENE_ID] }],
        scenes: {
            [SCENE_ID]: {
                id: SCENE_ID,
                name: "The corridor",
                runtimeName: "corridor",
                rootBlockIds: blocks.map(block => block.id),
                blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
            },
        },
    });
}

function storyFile(rows: string): string {
    const file = path.join(projectDir, "scene.story");
    fs.writeFileSync(file, `#nlstory 1\n#story First Day\n#scene The corridor ⟦${SCENE_ID}⟧\n\n${rows}\n`, "utf8");
    return file;
}

/** The row a file line `rows` put first sits on line 5: three directives and a blank line above it. */
const FIRST_ROW_LINE = 5;

async function cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(args, { out: text => out.push(text), err: text => err.push(text) });
    return { code, out: out.join("\n"), err: err.join("\n") };
}

const apply = (file: string) => cli("apply", file, "--project", projectDir, "--write");
const check = (file: string) => cli("check", file, "--project", projectDir);

async function show(): Promise<string> {
    const file = path.join(projectDir, "shown.story");
    const result = await cli("show", "--project", projectDir, "--scene", "The corridor", "--out", file);
    expect(result.code, result.err).toBe(0);
    return fs.readFileSync(file, "utf8");
}

function storedScene(): { rootBlockIds: string[]; blocks: Record<string, StoryBlock> } {
    const document = JSON.parse(fs.readFileSync(storyDocPath(), "utf8")) as StoryDocument;
    return document.scenes[SCENE_ID] as never;
}

function rowsOfKind(kind: StoryBlock["kind"]): StoryBlock[] {
    const scene = storedScene();
    return scene.rootBlockIds.map(id => scene.blocks[id]).filter(block => block?.kind === kind);
}

beforeEach(() => {
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-story-local-")));
    write("editor/story/index.json", {
        schemaVersion: 2,
        stories: [{ id: STORY_ID, name: "First Day" }],
        defaultStoryId: STORY_ID,
    });
    writeScene([]);
});

afterEach(() => {
    if (projectDir) {
        fs.rmSync(projectDir, { recursive: true, force: true });
    }
});

describe("a /local line in a file", () => {
    it("declares the variable, and is not reported as its own duplicate", async () => {
        const result = await apply(storyFile("/local hp 5"));

        expect(result.code, result.out + result.err).toBe(0);
        expect(result.out).not.toContain("duplicateVariable");
        const [row] = rowsOfKind("declaration");
        expect(row?.kind).toBe("declaration");
        if (row?.kind !== "declaration") {
            return;
        }
        // The row Studio's Enter would have landed: the storage key is the row's own id.
        expect(row.payload).toMatchObject({ scope: "scene", name: "hp", valueType: "number", defaultValue: 5 });
        expect(row.payload.storageKey).toBe(row.id);
    });

    it("is what the rows around it refer to, by the id it ends up with", async () => {
        const result = await apply(storyFile([
            "/local hp 5",
            "/set hp hp + 1",
            "/if",
            "  ? hp == 6",
            "    It held.",
            "  ? else",
            "    It did not.",
        ].join("\n")));

        expect(result.code, result.out + result.err).toBe(0);
        const [declared] = rowsOfKind("declaration");
        const [assignment] = rowsOfKind("action");
        expect(declared).toBeDefined();
        expect(assignment?.kind === "action" && assignment.payload.action === "setVariable"
            ? assignment.payload.target
            : null).toEqual({ scope: "scene", variableId: declared!.id });
        // The branch's condition names the same row. Searched as text so the test does not have to
        // know which of the condition shapes the expression landed as.
        const scene = storedScene();
        const branch = Object.values(scene.blocks).find(block =>
            block.kind === "control" && block.payload.control === "conditionBranch" && block.payload.branch === "if");
        expect(JSON.stringify(branch)).toContain(declared!.id);
    });

    it("refuses a second declaration of one name, on the later line only", async () => {
        const file = storyFile("/local hp 5\n/local HP 6");
        const result = await check(file);

        expect(result.code).toBe(1);
        const reported = result.out.split("\n").filter(line => line.startsWith("error"));
        expect(reported).toHaveLength(1);
        expect(reported[0]).toContain(`scene.story:${FIRST_ROW_LINE + 1}`);
        expect(result.out).toContain("duplicateVariable");
    });

    it("refuses a declaration of a name the scene already has", async () => {
        writeScene([declaration(STORED_HP_ID, "hp")]);
        const shown = await show();
        const result = await check(storyFile(`${shown.split("\n").slice(4).join("\n").trim()}\n/local hp 1`));

        expect(result.code).toBe(1);
        const reported = result.out.split("\n").filter(line => line.startsWith("error"));
        expect(reported).toHaveLength(1);
        expect(reported[0]).toContain(`scene.story:${FIRST_ROW_LINE + 1}`);
        expect(result.out).toContain("duplicateVariable");
    });

    it("does not count a declaration the file deletes", async () => {
        // The file describes the whole scene, so a stored row it leaves out is gone - and so is the
        // name that row declared. A line re-declaring it, and a line using it, are both fine.
        writeScene([declaration(STORED_HP_ID, "hp")]);
        const result = await apply(storyFile("/local hp 1\n/set hp 2"));

        expect(result.code, result.out + result.err).toBe(0);
        const [declared] = rowsOfKind("declaration");
        const [assignment] = rowsOfKind("action");
        expect(declared?.id).not.toBe(STORED_HP_ID);
        expect(assignment?.kind === "action" && assignment.payload.action === "setVariable"
            ? assignment.payload.target.variableId
            : null).toBe(declared?.id);
    });
});

describe("a stored declaration, printed and read back", () => {
    it("prints as the line that declares it, with its type and default", async () => {
        writeScene([
            declaration(STORED_HP_ID, "hp"),
            declaration(STORED_MP_ID, "name", { valueType: "string", defaultValue: "Narra", description: "Who is speaking" }),
        ]);
        const shown = await show();

        expect(shown).not.toContain("»");
        expect(shown).toMatch(/^\/local hp default=5 type=number {2}⟦44444444⟧$/m);
        expect(shown).toMatch(/^\/local name default=Narra type=string desc=.*Who is speaking.* {2}⟦55555555⟧$/m);
    });

    it.each([
        ["a number", { valueType: "number", defaultValue: 5 }],
        ["no default", { valueType: "boolean", defaultValue: undefined }],
        ["a false flag", { valueType: "boolean", defaultValue: false }],
        ["an empty string", { valueType: "string", defaultValue: "" }],
        ["a string with a space", { valueType: "string", defaultValue: "two words" }],
        ["a list", { valueType: "json", defaultValue: [1, 2] }],
        ["a description", { valueType: "number", defaultValue: 0, description: "Player health" }],
    ])("reads back unchanged with %s, byte for byte", async (_label, extra) => {
        writeScene([declaration(STORED_HP_ID, "hp", extra)]);
        const before = fs.readFileSync(storyDocPath(), "utf8");
        const shown = await show();
        expect(shown, shown).not.toContain("»");

        const file = storyFile(shown.split("\n").slice(4).join("\n").trim());
        const checked = await check(file);
        expect(checked.code, checked.out).toBe(0);
        const applied = await apply(file);
        expect(applied.code, applied.out + applied.err).toBe(0);
        expect(applied.out).toContain("No row changed.");
        expect(fs.readFileSync(storyDocPath(), "utf8")).toBe(before);
    });

    it("keeps the row's storage key when the line is edited", async () => {
        // The storage key is what a save files the value under; an edit to the default is an edit to
        // the row, not a new variable.
        writeScene([declaration(STORED_HP_ID, "hp", { storageKey: STORED_MP_ID })]);
        const shown = await show();
        const edited = shown.replace("default=5", "default=9");
        expect(edited).not.toBe(shown);

        const result = await apply(storyFile(edited.split("\n").slice(4).join("\n").trim()));
        expect(result.code, result.out + result.err).toBe(0);
        const [row] = rowsOfKind("declaration");
        expect(row?.id).toBe(STORED_HP_ID);
        expect(row?.kind === "declaration" ? row.payload : null).toMatchObject({ defaultValue: 9, storageKey: STORED_MP_ID });
    });

    it("keeps a duplicate the scene already holds verbatim, rather than spelling a line that would be refused", async () => {
        // Studio can leave two rows declaring one name (a rename in the inspector does not check).
        // The first is the one a bare name resolves to and prints as a line; the second's line would
        // be refused, so it is preserved whole instead - and the file still applies.
        writeScene([declaration(STORED_HP_ID, "hp"), declaration(STORED_SECOND_HP_ID, "hp", { defaultValue: 7 })]);
        const shown = await show();

        expect(shown).toMatch(/^\/local hp default=5 type=number {2}⟦44444444⟧$/m);
        expect(shown).toMatch(/^» .* {2}⟦66666666⟧$/m);
        const applied = await apply(storyFile(shown.split("\n").slice(4).join("\n").trim()));
        expect(applied.code, applied.out + applied.err).toBe(0);
        expect(applied.out).toContain("No row changed.");
    });
});
