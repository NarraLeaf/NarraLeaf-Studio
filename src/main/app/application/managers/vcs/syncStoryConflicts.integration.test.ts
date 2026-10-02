import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mergeDecisionKey } from "@shared/documents/mergeApply";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported } from "@shared/types/vcs";
import {
    STORY_DOCUMENT_SCHEMA_VERSION,
    STORY_LIBRARY_INDEX_SCHEMA_VERSION,
    type StoryDocument,
    type StoryLibraryIndex,
} from "@shared/types/story/document";
import {
    commit,
    createRepository,
    flushRepository,
    releaseRepository,
    stage,
    type LoreGlobals,
} from "./lore";
import { LORE_TEST_SERVER, loreTestIdentity, loreTestSession, loreTestSessionUse, signInLoreTestAccount } from "./loreTestAccount";
import { cloneInto, publishToRemote, pushToRemote, writeRemote } from "./remote";
import type { BaseApp } from "../../baseApp";
import { VcsManager } from "./VcsManager";

/**
 * Two people edit one story and one of them presses Get - the whole of it, through a real sync.
 *
 * What the author is handed afterwards is the subject: **only what somebody has to decide.** Every
 * save stamps the story's `meta.updatedAt` and its entry in the story library, so the backend's
 * line-by-line merge conflicts on the library, and on the story's stamp, however far apart the two
 * edits are. The format merges both of those with nothing to ask; a sync now settles them, and when
 * that was everything the merge is recorded the way a merge the backend settled itself is.
 *
 * `selfMergingConflicts.integration.test.ts` holds the settling itself on a local merge; this is the
 * same thing arriving the way an author meets it. Needs a server:
 *
 * ```bash
 * LORE_TEST_REMOTE="lore://127.0.0.1:41337" npx vitest run \
 *   src/main/app/application/managers/vcs/syncStoryConflicts.integration.test.ts
 * ```
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);
const SERVER = LORE_TEST_SERVER;
const enabled = supported && SERVER !== "";

const AUTHOR_NAME = "Ada Blackwood";
const AUTHOR = "spec@narraleaf";

const STORY_ID = "5f0c2d9a-8b1e-4c7d-9a3f-6e2b1d0c4a8e";
const STORY_PATH = `editor/story/stories/${STORY_ID}/storydoc.json`;
const INDEX_PATH = "editor/story/index.json";
const TITLE = "The Lighthouse";

const CREATED = "2026-09-20T10:00:00.000Z";
const BASE_SAVE = "2026-09-26T10:00:00.000Z";
const THEIR_SAVE = "2026-09-27T08:15:00.000Z";
const MY_SAVE = "2026-09-27T08:40:00.000Z";

const BASE = { spoken: "Is anyone there?", narrated: "The lamp is out." };

const roots: string[] = [];

function tmp(prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    roots.push(root);
    return root;
}

function offline(root: string): LoreGlobals {
    return { repositoryPath: root, offline: true, identity: AUTHOR, cache: true };
}

function online(root: string): LoreGlobals {
    return { ...offline(root), offline: false, identity: loreTestIdentity(AUTHOR) };
}

function serverUrl(name: string): string {
    return `${SERVER}/${name}-${Date.now().toString(36)}`;
}

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
        stories: [{ id: STORY_ID, name: TITLE, documentPath: STORY_PATH, createdAt: CREATED, updatedAt }],
        defaultStoryId: STORY_ID,
    };
}

/** Written the way `StoryService` writes them: the story, then the library entry it stamps. */
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

/** A settings store holding the author's name and, where the run has one, the test sign-in. */
function fakeApp(): BaseApp {
    const noop = () => undefined;
    const written = new Map<string, unknown>([["versionControl.authorName", AUTHOR_NAME]]);
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        projectTrustManager: { isTrusted: () => true, recordArrival: noop, forgetArrival: noop },
        getUserDataDir: () => os.tmpdir(),
        getGlobalState: () => ({
            get: (key: string) => {
                if (written.has(key)) return written.get(key);
                const session = loreTestSession();
                return key === "versionControl.serverSessions" && session ? [session] : undefined;
            },
            set: (key: string, value: unknown) => { written.set(key, value); },
        }),
    } as unknown as BaseApp;
}

afterAll(async () => {
    for (const root of roots) {
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // A held repository can outlive the test; a leftover temp directory is not a failure.
        }
    }
}, 120_000);

describe.skipIf(!enabled)("a sync after two people edited one story", () => {
    beforeAll(async () => {
        await signInLoreTestAccount(tmp("nl-storysync-signin-"));
    }, 60_000);

    /** The author and a collaborator, each with one save of the story; the collaborator's is sent. */
    async function twoSaves(
        name: string,
        mine: { spoken: string; narrated: string },
        theirs: { spoken: string; narrated: string },
    ): Promise<string> {
        const root = tmp(`nl-storysync-${name}-a-`);
        const created = await createRepository(offline(root), {
            repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
            description: "story sync spec",
        });
        save(root, BASE, BASE_SAVE);
        await commitAll(offline(root), root, "base");
        const url = serverUrl(name);
        await writeRemote(root, url);
        await publishToRemote(online(root), { url, repositoryId: created.repository });
        await pushToRemote(online(root));
        await releaseRepository(online(root));

        const other = path.join(tmp(`nl-storysync-${name}-b-`), "project");
        await cloneInto(online(other), { repositoryUrl: url });
        save(other, theirs, THEIR_SAVE);
        await commitAll(offline(other), other, "theirs");
        await pushToRemote(online(other));
        await releaseRepository(online(other));

        save(root, mine, MY_SAVE);
        await commitAll(offline(root), root, "mine");
        await releaseRepository(offline(root));
        return root;
    }

    it("hands the author one conflicted file, the story, when both rewrote the same line", async () => {
        const root = await twoSaves(
            "sameline",
            { ...BASE, spoken: "Is anyone there? Hello?" },
            { ...BASE, spoken: "Who's there?" },
        );
        const manager = new VcsManager(fakeApp(), undefined, undefined, loreTestSessionUse);
        try {
            const synced = await manager.sync(root);
            // Not the library: its two versions differ only by when each was saved.
            expect(synced.conflicts).toEqual([STORY_PATH]);
            const state = await manager.getMergeState(root);
            expect(state.inProgress).toBe(true);
            expect(state.conflicts).toEqual([STORY_PATH]);

            // So the library on disk is a library again, and the story can be called by its title.
            const library = JSON.parse(fs.readFileSync(path.join(root, INDEX_PATH), "utf-8")) as StoryLibraryIndex;
            expect(library.stories.map(entry => entry.name)).toEqual([TITLE]);

            // One question, about the line, named by its words - and no row for the story's stamp.
            const story = await manager.getMergeDocument(root, STORY_PATH);
            expect(story.decisions.map(one => [one.path.join("/"), one.outcome, one.subject])).toEqual([
                ["scenes/s-corridor/blocks/b-spoken/payload", "conflict", "Is anyone there? Hello?"],
            ]);

            // Answered, finished, and sent: the settled library travels in the same merge.
            await manager.completeMerge(root, [{
                path: STORY_PATH,
                choice: "per-change",
                changes: { [mergeDecisionKey(["scenes", "s-corridor", "blocks", "b-spoken", "payload"])]: "theirs" },
            }], {});
            expect((await manager.getMergeState(root)).inProgress).toBe(false);
            await expect(manager.push(root)).resolves.toBeTruthy();
        } finally {
            await manager.closeProject(root);
        }
    }, 300_000);

    it("records the merge itself when the two people rewrote different lines", async () => {
        const root = await twoSaves(
            "twolines",
            { ...BASE, spoken: "Is anyone there? Hello?" },
            { ...BASE, narrated: "The lamp is out, and the stairs are dark." },
        );
        const manager = new VcsManager(fakeApp(), undefined, undefined, loreTestSessionUse);
        try {
            const synced = await manager.sync(root);

            // Nothing anybody has to decide, so nothing to hand anybody: the same answer a sync gives
            // when the backend merged every file itself.
            expect(synced.conflicts).toEqual([]);
            expect((await manager.getMergeState(root)).inProgress).toBe(false);
            const [merge] = await manager.getHistory(root, 0, { includeDetails: true });
            expect(merge.parents).toHaveLength(2);
            expect(merge.author).toBe(loreTestSession()?.account.identity ?? AUTHOR_NAME);

            const story = JSON.parse(fs.readFileSync(path.join(root, STORY_PATH), "utf-8")) as StoryDocument;
            const blocks = story.scenes["s-corridor"].blocks as Record<string, { payload: { text: { value: string } } }>;
            expect(blocks["b-spoken"].payload.text.value).toBe("Is anyone there? Hello?");
            expect(blocks["b-narrated"].payload.text.value).toBe("The lamp is out, and the stairs are dark.");

            await expect(manager.push(root)).resolves.toBeTruthy();
        } finally {
            await manager.closeProject(root);
        }
    }, 300_000);
});
