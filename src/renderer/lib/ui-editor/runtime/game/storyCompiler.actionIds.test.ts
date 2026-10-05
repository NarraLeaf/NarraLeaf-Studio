import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { migrateStoryDocumentToLatest } from "@shared/story/migrateStoryDocument";
import { compileStudioStoryToNlr } from "./storyCompiler";

/**
 * A save resumes on the action it stopped at, by id. Every action the engine can stop on - a menu
 * waiting for the player, the step after a branch, a jump's fade - has to keep its id when the story
 * around it changes, or the save resumes on whatever holds that id now. A menu used to be numbered by
 * its place in the whole story (`a-31`), so one line written ahead of it, or another scene to start
 * from, and a save taken with it open resumed on a different action.
 *
 * Read off the shipped skeleton rather than a story written here: it is the one every author starts
 * from, and it has the menu, the condition, the jumps and the scene bookkeeping this is about.
 */

const STORIES = path.join(process.cwd(), "resources/templates/skeleton/content/editor/story/stories");
const CORRIDOR = "f306e2d5-70c0-421b-ba8a-c7b2d3ce9d33";
const CLUB = "5143dcd8-bebc-4468-b4e2-00f6d5781af6";
const LAST_LIGHT = "c083e0f3-8665-451a-800a-6d2cd5650d33";
const MENU = "195fa305-150f-44dd-a8a9-94e8a2ceefe7";
const LAST_LIGHT_CONDITION = "33451d3b-c09a-4bc2-98d6-3304ac7b9cd1";

type WalkedAction = { type: string; getId(): string };

function skeleton(): StoryDocument {
    const [dir] = fs.readdirSync(STORIES);
    return migrateStoryDocumentToLatest(JSON.parse(fs.readFileSync(path.join(STORIES, dir, "storydoc.json"), "utf-8")) as StoryDocument);
}

/** The skeleton's last-scene condition, copied under fresh ids into the club room at `index`. */
function withConditionInClub(index: number): StoryDocument {
    const doc = skeleton();
    const source = doc.scenes[LAST_LIGHT].blocks;
    const club = doc.scenes[CLUB];
    const copy = (id: string, parentId: string | null): string => {
        const block = source[id];
        const nextId = `copy-${id}`;
        club.blocks[nextId] = {
            ...block,
            id: nextId,
            parentId,
            childrenIds: block.childrenIds.map(child => copy(child, nextId)),
        } as StoryBlock;
        return nextId;
    };
    club.rootBlockIds.splice(index, 0, copy(LAST_LIGHT_CONDITION, null));
    return doc;
}

async function compile(document: StoryDocument, sceneId: string) {
    const compiled = await compileStudioStoryToNlr({
        document,
        sceneId,
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
    } as Parameters<typeof compileStudioStoryToNlr>[0]);
    const story = compiled.story as unknown as {
        constructStory(): void;
        entryScene: {
            getSceneRoot(): unknown;
            getAllChildren(story: unknown, action: unknown, options: { allowFutureScene: boolean }): WalkedAction[];
        };
    };
    story.constructStory();
    const actions = story.entryScene.getAllChildren(story, story.entryScene.getSceneRoot(), { allowFutureScene: true });
    return { compiled, actions };
}

const isPositional = (id: string): boolean => /^a-\d+$/.test(id);

/** `id -> type` for every action the walk reaches that is not numbered by position. */
function namedActions(actions: readonly WalkedAction[]): Map<string, string> {
    return new Map(actions.filter(action => !isPositional(action.getId())).map(action => [action.getId(), action.type]));
}

describe("action ids", () => {
    it("names a menu after its row", async () => {
        const { compiled, actions } = await compile(skeleton(), CLUB);
        const menus = actions.filter(action => action.type === "menu:action").map(action => action.getId());
        expect(menus).toEqual([`nl:action:${CLUB}:${MENU}:menu:action:0`]);
        // Bound to the row like a row's own actions, so a save stopped on it says where it stopped.
        expect(compiled.actionIdBindings.find(binding => binding.staticId === menus[0])?.blockId).toBe(MENU);
    });

    it("leaves nothing to be numbered", async () => {
        for (const sceneId of [CORRIDOR, CLUB, LAST_LIGHT]) {
            const { actions } = await compile(skeleton(), sceneId);
            expect(actions.filter(action => isPositional(action.getId())).map(action => action.type)).toEqual([]);
            // What a scene builds for itself - its root and the steps that put it on the stage - only
            // the engine can reach, and it names them after the scene the compiler named.
            expect(actions.some(action => action.getId() === `nl:scene:${sceneId}:root`)).toBe(true);
            // A condition, a script and a jump's own steps are among what is named now.
            const types = new Set(actions.filter(action => action.getId().startsWith("nl:action:")).map(action => action.type));
            expect(types.has("condition:action")).toBe(true);
            expect(types.has("script:action")).toBe(true);
        }
    });

    it("keeps every name when a row is written ahead of it", async () => {
        const before = namedActions((await compile(skeleton(), CLUB)).actions);
        expect(before.get(`nl:action:${CLUB}:${MENU}:menu:action:0`)).toBe("menu:action");
        for (const index of [0, 9]) {
            // At the top of the scene, and directly above the menu.
            const after = namedActions((await compile(withConditionInClub(index), CLUB)).actions);
            const moved = [...before].filter(([id, type]) => after.get(id) !== type);
            expect(moved).toEqual([]);
        }
    });

    it("keeps every name when the story starts from another scene", async () => {
        const fromClub = namedActions((await compile(skeleton(), CLUB)).actions);
        const fromCorridor = namedActions((await compile(skeleton(), CORRIDOR)).actions);
        const moved = [...fromClub].filter(([id, type]) => fromCorridor.get(id) !== type);
        expect(moved).toEqual([]);
        expect(fromCorridor.get(`nl:action:${CLUB}:${MENU}:menu:action:0`)).toBe("menu:action");
    });

    it("never gives a row's own scheme to an action the row's statement did not list", async () => {
        // Reading old saves depends on it: `studio:` ids are exactly the ones a build before this
        // gave, and everything else was numbered.
        const { compiled, actions } = await compile(skeleton(), CORRIDOR);
        const listed = new Set(compiled.actionIdBindings.map(binding => binding.staticId).filter(id => id.startsWith("studio:")));
        for (const action of actions) {
            const id = action.getId();
            expect(id.startsWith("studio:") ? listed.has(id) : id.startsWith("nl:action:") || id.startsWith("nl:scene:")).toBe(true);
        }
    });
});
