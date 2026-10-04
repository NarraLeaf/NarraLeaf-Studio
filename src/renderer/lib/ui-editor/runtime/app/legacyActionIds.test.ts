import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DevTools, type SavedGame } from "narraleaf-react";
import type { StoryDocument } from "@shared/types/story";
import { migrateStoryDocumentToLatest } from "@shared/story/migrateStoryDocument";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import {
    buildLegacyActionIdTable,
    engineStoryHash,
    translateLegacyActionIds,
    type LegacyActionWalkStory,
} from "./legacyActionIds";

/**
 * A save written before every action had a name holds the engine's numbers for a menu, a condition, a
 * script and a scene's own steps. Those numbers are translated only when the story is provably the one
 * the save was written against - and the proof is the engine's own hash, which the naming changed.
 *
 * "Written by a build before" is produced for real rather than imitated: the same compiled story,
 * with the names this change gives taken off and the engine left to number those actions again, is
 * exactly what that build constructed. Its hash and its numbers are then the engine's own.
 */

const STORIES = path.join(process.cwd(), "resources/templates/skeleton/content/editor/story/stories");
const CLUB = "5143dcd8-bebc-4468-b4e2-00f6d5781af6";
const MENU = "195fa305-150f-44dd-a8a9-94e8a2ceefe7";
const MENU_ID = `nl:action:${CLUB}:${MENU}:menu:action:0`;

type Action = Parameters<typeof DevTools.setStaticId>[0];
type ConstructedStory = LegacyActionWalkStory & { constructStory(): void; hash(): string };

function skeleton(): StoryDocument {
    const [dir] = fs.readdirSync(STORIES);
    return migrateStoryDocumentToLatest(JSON.parse(fs.readFileSync(path.join(STORIES, dir, "storydoc.json"), "utf-8")) as StoryDocument);
}

function walk(story: ConstructedStory): Action[] {
    const scene = story.entryScene!;
    return scene.getAllChildren(story, scene.getSceneRoot(), { allowFutureScene: true }) as unknown as Action[];
}

/**
 * The story as this build constructs it, and as the build before constructed it: the old numbers and
 * the old hash, taken from the engine with the new names off, and the story then put back.
 */
async function bothBuilds(document: StoryDocument) {
    const compiled = await compileStudioStoryToNlr({
        document,
        sceneId: CLUB,
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
    } as Parameters<typeof compileStudioStoryToNlr>[0]);
    const story = compiled.story as unknown as ConstructedStory;
    story.constructStory();

    const renamed = walk(story).filter(action => DevTools.getStaticId(action)?.startsWith("nl:action:"));
    const names = new Map(renamed.map(action => [action, DevTools.getStaticId(action)!]));
    renamed.forEach(action => DevTools.setStaticId(action, null));
    story.constructStory();
    const oldIdByNewId = new Map(renamed.map(action => [names.get(action)!, action.getId()]));
    const oldHash = story.hash();

    renamed.forEach(action => DevTools.setStaticId(action, names.get(action)!));
    story.constructStory();
    return { story, oldIdByNewId, oldHash };
}

function saveAtMenu(menuId: string, storyHash: string): SavedGame {
    const stack = { items: [{ type: "action", actionType: "menu:action", action: menuId }] };
    return {
        name: "slot",
        meta: { created: 1, updated: 2, id: "m", lastSentence: "Which?", lastSpeaker: null, storyHash, version: 3 },
        game: {
            store: {},
            services: {},
            elementStates: [],
            stage: { scenes: [], audio: { sounds: [] }, videos: [], vfx: [] },
            stackModel: stack,
            asyncStackModels: [],
            history: [
                { token: "t1", actionId: "studio:line", element: { type: "say" }, isPending: false, snapshot: null },
                {
                    token: "t2",
                    actionId: menuId,
                    element: { type: "menu" },
                    isPending: true,
                    snapshot: { store: {}, elementStates: [], stage: {}, stackModel: stack, asyncStackModels: [], services: {} },
                },
            ],
        },
    } as unknown as SavedGame;
}

describe("reading action numbers from before every action was named", () => {
    it("holds its copy of the engine's hash function to the engine's", async () => {
        const { story } = await bothBuilds(skeleton());
        expect(engineStoryHash(story.stringify(false))).toBe(story.hash());
    });

    it("recomputes the hash the build before wrote, and the numbers it gave", async () => {
        const { story, oldIdByNewId, oldHash } = await bothBuilds(skeleton());
        const table = buildLegacyActionIdTable(story);

        expect(story.hash()).not.toBe(oldHash);
        expect(table.storyHash()).toBe(oldHash);
        expect(oldIdByNewId.size).toBeGreaterThan(0);
        for (const [newId, oldId] of oldIdByNewId) {
            expect(table.numbering.get(oldId)).toBe(newId);
        }
        // The names the hash borrowed for a moment are back.
        expect(walk(story).some(action => action.getId() === MENU_ID)).toBe(true);
        expect(engineStoryHash(story.stringify(false))).toBe(story.hash());
    });

    it("puts a save taken with the menu open back on the menu", async () => {
        const { story, oldIdByNewId, oldHash } = await bothBuilds(skeleton());
        const oldMenuId = oldIdByNewId.get(MENU_ID)!;
        expect(oldMenuId).toMatch(/^a-\d+$/);

        const { savedGame, unmappable } = translateLegacyActionIds(saveAtMenu(oldMenuId, oldHash), buildLegacyActionIdTable(story), "legacy");
        expect(unmappable).toEqual([]);
        const game = savedGame.game as unknown as {
            stackModel: { items: { action: string }[] };
            history: { actionId: string; snapshot: { stackModel: { items: { action: string }[] } } | null }[];
        };
        expect(game.stackModel.items[0].action).toBe(MENU_ID);
        expect(game.history.map(entry => entry.actionId)).toEqual(["studio:line", MENU_ID]);
        expect(game.history[1].snapshot?.stackModel.items[0].action).toBe(MENU_ID);
    });

    it("tells a story with a row written ahead apart by its hash", async () => {
        const original = await bothBuilds(skeleton());
        const edited = skeleton();
        const club = edited.scenes[CLUB];
        // A condition at the top of the scene: one more numbered action ahead of the menu.
        club.blocks["extra-if"] = { id: "extra-if", kind: "control", parentId: null, childrenIds: [], payload: { control: "condition" } } as never;
        const lastLight = edited.scenes["c083e0f3-8665-451a-800a-6d2cd5650d33"].blocks;
        const branch = lastLight["ba294d91-a990-4119-9a92-12fb0fc31bdb"];
        club.blocks["extra-branch"] = { ...branch, id: "extra-branch", parentId: "extra-if", childrenIds: [] } as never;
        (club.blocks["extra-if"] as { childrenIds: string[] }).childrenIds = ["extra-branch"];
        club.rootBlockIds.unshift("extra-if");
        const changed = await bothBuilds(edited);

        expect(buildLegacyActionIdTable(changed.story).storyHash()).not.toBe(original.oldHash);
        // Which is the whole reason the number is not trusted there: it now names another action.
        const oldMenuId = original.oldIdByNewId.get(MENU_ID)!;
        expect(buildLegacyActionIdTable(changed.story).numbering.get(oldMenuId)).not.toBe(MENU_ID);
    });

    it("refuses to place a number it cannot prove, and lets go of backlog lines standing on one", () => {
        const table = { numbering: new Map([["a-11", MENU_ID]]), storyHash: () => "old" };
        const resumed = translateLegacyActionIds(saveAtMenu("a-11", "old"), table, "unknown");
        expect(resumed.unmappable).toEqual(["a-11"]);

        const onlyBacklog = saveAtMenu("studio:menu-row", "old");
        (onlyBacklog.game as unknown as { history: { actionId: string }[] }).history[1].actionId = "a-11";
        const kept = translateLegacyActionIds(onlyBacklog, table, "unknown");
        expect(kept.unmappable).toEqual([]);
        expect((kept.savedGame.game as unknown as { history: { actionId: string }[] }).history.map(entry => entry.actionId)).toEqual(["studio:line"]);
    });

    it("leaves a save alone when its numbers are this story's own", () => {
        const table = { numbering: new Map([["a-11", MENU_ID]]), storyHash: () => "old" };
        const save = saveAtMenu("a-3", "live");
        expect(translateLegacyActionIds(save, table, "current")).toEqual({ savedGame: save, unmappable: [] });
        const named = saveAtMenu(MENU_ID, "live");
        expect(translateLegacyActionIds(named, table, "unknown")).toEqual({ savedGame: named, unmappable: [] });
    });
});
