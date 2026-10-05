import { describe, expect, it } from "vitest";
import type { SavedGame } from "narraleaf-react";
import {
    buildSaveBuildStamp,
    buildSaveCompatibilityStamp,
    DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION,
} from "@shared/types/saveCompatibility";
import { translate } from "@/lib/i18n";
import type { LegacyActionIdTable } from "./legacyActionIds";
import { loadSaveIntoGame, readSavePosition, type SaveLoadGameSeam } from "./saveLoad";

/**
 * The load path's half of reading a menu save from before every action had a name: the number is
 * translated before the save is checked against the running story, the translated save is what
 * reaches the engine, and a number nothing can prove is refused rather than resumed on.
 */

const STORY = "story-1";
const DOCUMENT_HASH = "document-v1";
/** The running story's hash, and the same story's hash under the old numbers. */
const LIVE_HASH = "engine-named";
const OLD_HASH = "engine-numbered";
const MENU_ID = "nl:action:club:menu-row:menu:action:0";

const TABLE: LegacyActionIdTable = {
    numbering: new Map([["a-11", MENU_ID]]),
    storyHash: () => OLD_HASH,
};

function saveAtMenu(menuId: string, storyHash: string): SavedGame {
    return {
        name: "slot",
        meta: { created: 1, updated: 2, id: "m", lastSentence: "What do we make?", lastSpeaker: null, storyHash, version: 3 },
        game: {
            store: { game: {} },
            services: {},
            elementStates: [],
            stage: { scenes: [], audio: { sounds: [] }, videos: [], vfx: [] },
            stackModel: { items: [{ type: "action", actionType: "menu:action", action: menuId }] },
            asyncStackModels: [],
            history: [{ token: "t", actionId: menuId, element: { type: "menu" }, isPending: true, snapshot: null }],
        },
    } as unknown as SavedGame;
}

function load(options: { save: SavedGame; documentHash: string }) {
    const applied: SavedGame[] = [];
    const reports: string[] = [];
    const game: SaveLoadGameSeam = {
        // `a-11` still answers, as a number does in any story the engine still numbers part of: it
        // exists today and names something else. The refusal cannot lean on the number being missing.
        resolveStoryMaps: () => ({ hasAction: id => id === MENU_ID || id === "a-11", hasElement: () => true }),
        readStoryHash: () => LIVE_HASH,
        snapshot: () => null,
        apply: savedGame => {
            applied.push(savedGame);
        },
        restore: () => {},
        legacyActionIds: () => TABLE,
    };
    const outcome = loadSaveIntoGame({
        id: "slot-1",
        readRecord: async () => ({
            savedGame: options.save,
            metadata: { compatibility: buildSaveCompatibilityStamp({ storyId: STORY, storyHash: options.documentHash, gameVersion: "1.0" }) },
        }),
        game,
        build: buildSaveBuildStamp({ storyHashes: { [STORY]: DOCUMENT_HASH }, gameVersion: "1.0" }),
        // The changed-document case is only reached as written when the author asked for that.
        compatibilityConfig: { ...DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION, incompatible: "force" },
        notifyPlayer: () => {},
        report: (_level, message) => {
            reports.push(message);
        },
    });
    return { outcome, applied, reports };
}

const stackIdOf = (savedGame: SavedGame): string =>
    (savedGame.game as unknown as { stackModel: { items: { action: string }[] } }).stackModel.items[0].action;

describe("loading a save taken with a menu open, from before menus had names", () => {
    it("puts it back on the menu when it was written against this very story", async () => {
        const { outcome, applied, reports } = load({ save: saveAtMenu("a-11", OLD_HASH), documentHash: DOCUMENT_HASH });

        // The same story: the hash only moved because its actions were named.
        expect(await outcome).toMatchObject({ status: "loaded", applied: "save", origin: "sameStory" });
        expect(stackIdOf(applied[0])).toBe(MENU_ID);
        expect((applied[0].game as unknown as { history: { actionId: string }[] }).history[0].actionId).toBe(MENU_ID);
        expect(reports).toEqual([]);
    });

    it("refuses it with the ordinary message when the story has changed since", async () => {
        const { outcome, applied } = load({ save: saveAtMenu("a-11", "engine-from-before-the-edit"), documentHash: "document-v0" });
        const result = await outcome;

        expect(result).toMatchObject({ status: "refused", reason: "unresolved", unresolvedIds: ["a-11"], game: "unchanged" });
        expect(result.status === "refused" && result.detail).toBe(translate("game.saveLoad.detail.savedAt", {
            detail: translate("game.saveLoad.detail.unresolvedAction"),
            line: "What do we make?",
        }));
        expect(applied).toEqual([]);
    });

    it("refuses it when the document is the same but the story was entered elsewhere", async () => {
        // Same document hash, but the engine's hash under the old numbers is not the save's: the
        // story starts at another scene, so every number means something else.
        const { outcome, applied } = load({ save: saveAtMenu("a-11", "engine-entered-elsewhere"), documentHash: DOCUMENT_HASH });

        expect(await outcome).toMatchObject({ status: "refused", reason: "unresolved", unresolvedIds: ["a-11"] });
        expect(applied).toEqual([]);
    });

    it("loads a save written since as it is, whatever changed", async () => {
        const { outcome, applied } = load({ save: saveAtMenu(MENU_ID, "engine-from-before-the-edit"), documentHash: "document-v0" });

        expect(await outcome).toMatchObject({ status: "loaded", applied: "save" });
        expect(stackIdOf(applied[0])).toBe(MENU_ID);
    });

    it("reads the row a save stopped on from a menu's name", () => {
        expect(readSavePosition(saveAtMenu(MENU_ID, LIVE_HASH))).toEqual({ storyId: "", sceneId: "club", blockId: "menu-row" });
    });
});
