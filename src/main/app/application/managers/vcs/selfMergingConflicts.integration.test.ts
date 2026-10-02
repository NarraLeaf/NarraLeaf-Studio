import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported } from "@shared/types/vcs";
import {
    STORY_DOCUMENT_SCHEMA_VERSION,
    STORY_LIBRARY_INDEX_SCHEMA_VERSION,
    type StoryDocument,
    type StoryLibraryIndex,
} from "@shared/types/story/document";
import {
    branchMergeStart,
    commit,
    createBranch,
    createRepository,
    flushRepository,
    releaseRepository,
    stage,
    switchBranch,
    type LoreGlobals,
} from "./lore";
import { abortMerge, readMergeState, resolveConflicts, settleSelfMergingConflicts } from "./merge";
import { readMergeDocument } from "./mergeDocument";

/**
 * Settling what merges by itself, against a real repository and the two files every story edit
 * writes.
 *
 * **Why these two files, and why they conflict at all.** Saving a story stamps the story's own
 * `meta.updatedAt` and its entry's `updatedAt` in the story library. So two people who each edited one
 * line of the same story leave BOTH files conflicted to the backend's line-by-line merge: the story,
 * over the line and over the stamp, and the library, over the stamp and nothing else. The library's
 * format merges that with nothing to ask, and until it was settled here it sat in the merge panel as a
 * file "whose two versions are the same" that still waited for a press.
 *
 * A local two-branch merge rather than a sync: both leave the same files on disk (docs §4.23), and
 * this needs no server. `syncStoryConflicts.integration.test.ts` runs the whole thing through a sync.
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);

const STORY_ID = "5f0c2d9a-8b1e-4c7d-9a3f-6e2b1d0c4a8e";
const STORY_PATH = `editor/story/stories/${STORY_ID}/storydoc.json`;
const INDEX_PATH = "editor/story/index.json";
const TITLE = "The Lighthouse";

const CREATED = "2026-09-20T10:00:00.000Z";
const BASE_SAVE = "2026-09-26T10:00:00.000Z";
const THEIR_SAVE = "2026-09-27T08:15:00.000Z";
const MY_SAVE = "2026-09-27T08:40:00.000Z";

const roots: string[] = [];
const held: LoreGlobals[] = [];

function tmp(prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    roots.push(root);
    return root;
}

function offline(root: string): LoreGlobals {
    const globals: LoreGlobals = { repositoryPath: root, offline: true, identity: "spec@narraleaf", cache: true };
    held.push(globals);
    return globals;
}

/** A story as Studio stores one: one scene, a spoken line and a narrated one. */
function storyDocument(lines: { spoken: string; narrated: string }, updatedAt: string): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: STORY_ID,
        name: TITLE,
        entrySceneId: "s-corridor",
        chapters: [{ id: "ch-1", name: "Chapter 1", sceneIds: ["s-corridor"] }],
        scenes: {
            "s-corridor": {
                id: "s-corridor",
                name: "The corridor",
                runtimeName: "corridor",
                rootBlockIds: ["b-spoken", "b-narrated"],
                blocks: {
                    "b-spoken": {
                        id: "b-spoken",
                        kind: "nodeAction",
                        parentId: null,
                        childrenIds: [],
                        payload: {
                            action: "dialogue",
                            characterId: "c-narra",
                            text: { textId: "t-spoken", value: lines.spoken, role: "dialogue" },
                        },
                    },
                    "b-narrated": {
                        id: "b-narrated",
                        kind: "nodeAction",
                        parentId: null,
                        childrenIds: [],
                        payload: {
                            action: "narration",
                            text: { textId: "t-narrated", value: lines.narrated, role: "narration" },
                        },
                    },
                },
            },
        },
        meta: { createdAt: CREATED, updatedAt },
    } as StoryDocument;
}

function storyIndex(updatedAt: string): StoryLibraryIndex {
    return {
        schemaVersion: STORY_LIBRARY_INDEX_SCHEMA_VERSION,
        stories: [{
            id: STORY_ID,
            name: TITLE,
            documentPath: STORY_PATH,
            createdAt: CREATED,
            updatedAt,
        }],
        defaultStoryId: STORY_ID,
    };
}

/** Written the way `StoryService` writes them, which is what the backend's line merge sees. */
function save(root: string, lines: { spoken: string; narrated: string }, updatedAt: string): void {
    for (const [relative, value] of [
        [STORY_PATH, storyDocument(lines, updatedAt)],
        [INDEX_PATH, storyIndex(updatedAt)],
    ] as const) {
        const absolute = path.join(root, relative);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, JSON.stringify(value, null, 2), "utf-8");
    }
}

async function commitAll(globals: LoreGlobals, root: string, message: string): Promise<void> {
    await stage(globals, [root]);
    await commit(globals, message);
    await flushRepository(globals);
}

const BASE = { spoken: "Is anyone there?", narrated: "The lamp is out." };

/**
 * Two branches that saved the same story, and a merge started between them.
 *
 * `theirs` is what the collaborator's branch holds and `mine` what the author's does - the author's
 * branch is the one the merge runs on, so the sidecars and the conflict markers are oriented the way a
 * sync orients them (§4.31).
 */
async function mergedStory(
    prefix: string,
    mine: { spoken: string; narrated: string },
    theirs: { spoken: string; narrated: string },
): Promise<{ root: string; globals: LoreGlobals; before: Record<string, string> }> {
    const root = tmp(prefix);
    const globals = offline(root);
    await createRepository(globals, { repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL, description: "self-merging spec" });
    save(root, BASE, BASE_SAVE);
    await commitAll(globals, root, "base");

    const branch = `collaborator-${Date.now().toString(36)}`;
    await createBranch(globals, branch);
    await switchBranch(globals, { branch });
    save(root, theirs, THEIR_SAVE);
    await commitAll(globals, root, "theirs");

    await switchBranch(globals, { branch: "main" });
    save(root, mine, MY_SAVE);
    await commitAll(globals, root, "mine");
    const before = Object.fromEntries([STORY_PATH, INDEX_PATH].map(relative =>
        [relative, fs.readFileSync(path.join(root, relative), "utf-8")]));

    await branchMergeStart(globals, { branch });
    await flushRepository(globals);
    return { root, globals, before };
}

function sidecarsBeside(root: string, relative: string): string[] {
    return ["~base", "~mine", "~theirs"].filter(suffix => fs.existsSync(path.join(root, `${relative}${suffix}`)));
}

afterAll(async () => {
    for (const globals of held) await releaseRepository(globals).catch(() => undefined);
    for (const root of roots) {
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // A held repository can outlive the test; a leftover temp directory is not a failure.
        }
    }
}, 120_000);

describe.skipIf(!supported)("conflicts that merge by themselves", () => {
    it("settles the story library and leaves the story, whose line both people rewrote", async () => {
        const fixture = await mergedStory(
            "nl-selfmerge-line-",
            { ...BASE, spoken: "Is anyone there? Hello?" },
            { ...BASE, spoken: "Who's there?" },
        );
        // The backend's view: both files, the library over nothing but a stamp.
        expect((await readMergeState(fixture.globals, fixture.root)).conflicts).toEqual([INDEX_PATH, STORY_PATH]);

        const settled = await settleSelfMergingConflicts(fixture.globals, fixture.root, [INDEX_PATH, STORY_PATH]);

        expect(settled).toEqual([INDEX_PATH]);
        const state = await readMergeState(fixture.globals, fixture.root);
        expect(state.inProgress).toBe(true);
        expect(state.conflicts).toEqual([STORY_PATH]);
        // The library on disk is the merge's result again - a document, not diff3 markers - so the
        // titles in it can be read, and the stamp is the later of the two saves.
        const library = JSON.parse(fs.readFileSync(path.join(fixture.root, INDEX_PATH), "utf-8")) as StoryLibraryIndex;
        expect(library.stories.map(entry => [entry.name, entry.updatedAt])).toEqual([[TITLE, MY_SAVE]]);
        expect(sidecarsBeside(fixture.root, INDEX_PATH)).toEqual([]);
        // The story still has its question, and only that one.
        const story = await readMergeDocument(fixture.root, STORY_PATH);
        expect(story.decisions.map(one => [one.path.join("/"), one.outcome])).toEqual([
            ["scenes/s-corridor/blocks/b-spoken/payload", "conflict"],
        ]);

        // Abandoning still puts everything back the way the author had it, the settled file included.
        await abortMerge(fixture.globals, fixture.root);
        for (const [relative, text] of Object.entries(fixture.before)) {
            expect(fs.readFileSync(path.join(fixture.root, relative), "utf-8")).toBe(text);
            expect(sidecarsBeside(fixture.root, relative)).toEqual([]);
        }
        expect((await readMergeState(fixture.globals, fixture.root)).inProgress).toBe(false);
        await releaseRepository(fixture.globals);
    }, 180_000);

    it("settles both files when the two people rewrote different lines", async () => {
        const fixture = await mergedStory(
            "nl-selfmerge-lines-",
            { ...BASE, spoken: "Is anyone there? Hello?" },
            { ...BASE, narrated: "The lamp is out, and the stairs are dark." },
        );
        const conflicted = (await readMergeState(fixture.globals, fixture.root)).conflicts;
        // Two different lines, and the backend still conflicts on both files: the stamps.
        expect(conflicted).toEqual([INDEX_PATH, STORY_PATH]);

        const settled = await settleSelfMergingConflicts(fixture.globals, fixture.root, conflicted);

        expect([...settled].sort()).toEqual([INDEX_PATH, STORY_PATH]);
        expect((await readMergeState(fixture.globals, fixture.root)).conflicts).toEqual([]);
        const story = JSON.parse(fs.readFileSync(path.join(fixture.root, STORY_PATH), "utf-8")) as StoryDocument;
        const blocks = story.scenes["s-corridor"].blocks as Record<string, { payload: { text: { value: string } } }>;
        expect(blocks["b-spoken"].payload.text.value).toBe("Is anyone there? Hello?");
        expect(blocks["b-narrated"].payload.text.value).toBe("The lamp is out, and the stairs are dark.");
        expect(story.meta?.updatedAt).toBe(MY_SAVE);

        // And it can be recorded: nothing is left for the commit to refuse.
        await commitAll(fixture.globals, fixture.root, "merged");
        expect((await readMergeState(fixture.globals, fixture.root)).inProgress).toBe(false);
        await releaseRepository(fixture.globals);
    }, 180_000);

    it("leaves a settled file's choice to the author when they take a side of the rest", async () => {
        const fixture = await mergedStory(
            "nl-selfmerge-take-",
            { ...BASE, spoken: "Is anyone there? Hello?" },
            { ...BASE, spoken: "Who's there?" },
        );
        await settleSelfMergingConflicts(fixture.globals, fixture.root, [INDEX_PATH, STORY_PATH]);

        await resolveConflicts(fixture.globals, fixture.root, [STORY_PATH], "theirs");
        await commitAll(fixture.globals, fixture.root, "took theirs");

        const story = JSON.parse(fs.readFileSync(path.join(fixture.root, STORY_PATH), "utf-8")) as StoryDocument;
        const spoken = (story.scenes["s-corridor"].blocks["b-spoken"].payload as { text: { value: string } }).text.value;
        expect(spoken).toBe("Who's there?");
        expect((await readMergeState(fixture.globals, fixture.root)).inProgress).toBe(false);
        await releaseRepository(fixture.globals);
    }, 180_000);
});
