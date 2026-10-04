import { describe, expect, it } from "vitest";
import type { SavedGame } from "narraleaf-react";
import {
    buildSaveBuildStamp,
    buildSaveCompatibilityStamp,
    DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION,
} from "@shared/types/saveCompatibility";
import { translate } from "@/lib/i18n";
import type { LegacyElementIdTable } from "./legacyElementIds";
import { loadSaveIntoGame, type SaveLoadGameSeam } from "./saveLoad";

/**
 * The load path's half of reading an old save: the names are translated before the save is checked
 * against the running story, the translated save is what reaches the engine, and a save that cannot
 * be translated is refused with the message any save naming something missing gets.
 */

const STORY = "story-1";
const DOCUMENT_HASH = "document-v1";
const ENGINE_HASH = "engine-h";

/** What the running story holds today. */
const TODAY = new Set([
    "nl:scene:club",
    "nl:camera",
    "nl:scene:club:music",
    "nl:sound:club:rain",
]);

/** Old numbering of the running story, and the club room's one track. */
const TABLE: LegacyElementIdTable = {
    numbering: new Map([["e-30", "nl:camera"], ["e-7", "nl:sound:club:rain"], ["s-0", "nl:scene:club:music"]]),
    sceneMusic: new Map([["nl:scene:club", ["nl:scene:club:music"]]]),
};

function oldSave(): SavedGame {
    return {
        name: "slot",
        meta: { created: 1, updated: 2, id: "m", lastSentence: "the chalk dust", lastSpeaker: null, storyHash: ENGINE_HASH, version: 3 },
        game: {
            store: { game: {} },
            services: {},
            elementStates: [
                { id: "e-30", data: { transformState: { zoom: 1.5 } } },
                { id: "nl:scene:club", data: { state: { backgroundMusic: { state: { volume: 1 }, id: "s-0" } } } },
                { id: "e-7", data: { state: { volume: 0.4, rate: 1, paused: false, muted: false } } },
            ],
            stage: {
                scenes: [{ sceneId: "nl:scene:club", elements: { layers: {} } }],
                audio: { sounds: [["s-0", { isPlaying: true, position: 12.5 }], ["e-7", { isPlaying: true, position: 3 }]] },
                videos: [],
                vfx: [],
            },
            stackModel: { items: [] },
            asyncStackModels: [],
            history: [],
        },
    } as unknown as SavedGame;
}

function load(options: { documentHash: string }) {
    const applied: SavedGame[] = [];
    const game: SaveLoadGameSeam = {
        resolveStoryMaps: () => ({ hasAction: () => true, hasElement: id => TODAY.has(id) }),
        readStoryHash: () => ENGINE_HASH,
        snapshot: () => null,
        apply: savedGame => {
            applied.push(savedGame);
        },
        restore: () => {},
        legacyElementIds: () => TABLE,
    };
    const outcome = loadSaveIntoGame({
        id: "slot-1",
        readRecord: async () => ({
            savedGame: oldSave(),
            metadata: { compatibility: buildSaveCompatibilityStamp({ storyId: STORY, storyHash: options.documentHash, gameVersion: "1.0" }) },
        }),
        game,
        build: buildSaveBuildStamp({ storyHashes: { [STORY]: DOCUMENT_HASH }, gameVersion: "1.0" }),
        // A save from another version of the document is restarted at its line by default; an author
        // who asked for it to be loaded as it is ("force") is the case where the names matter.
        compatibilityConfig: { ...DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION, incompatible: "force" },
        notifyPlayer: () => {},
        report: () => {},
    });
    return { outcome, applied };
}

describe("loading a save written before the camera and the sounds had stable names", () => {
    it("applies it under today's names when it was written against this very story", async () => {
        const { outcome, applied } = load({ documentHash: DOCUMENT_HASH });

        expect(await outcome).toMatchObject({ status: "loaded", applied: "save" });
        const game = applied[0].game as unknown as {
            elementStates: { id: string; data: { state?: { backgroundMusic?: { id: string } } } }[];
            stage: { audio: { sounds: [string, unknown][] } };
        };
        expect(game.elementStates.map(entry => entry.id)).toEqual(["nl:camera", "nl:scene:club", "nl:sound:club:rain"]);
        expect(game.elementStates[1].data.state?.backgroundMusic?.id).toBe("nl:scene:club:music");
        expect(game.stage.audio.sounds.map(([id]) => id)).toEqual(["nl:scene:club:music", "nl:sound:club:rain"]);
    });

    it("refuses it with the ordinary message when the story has changed and a sound it holds cannot be named", async () => {
        // A patch changed the document, so the old numbering is not this story's. The camera and the
        // club room's only track are still found; the rain loop's level has nowhere it can go.
        const { outcome, applied } = load({ documentHash: "document-v0" });
        const result = await outcome;

        expect(result).toMatchObject({ status: "refused", reason: "unresolved", unresolvedIds: ["e-7"], game: "unchanged" });
        expect(result.status === "refused" && result.detail).toBe(translate("game.saveLoad.detail.savedAt", {
            detail: translate("game.saveLoad.detail.unresolvedElement"),
            line: "the chalk dust",
        }));
        expect(applied).toEqual([]);
    });
});
