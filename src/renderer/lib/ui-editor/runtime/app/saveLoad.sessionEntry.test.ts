import { describe, expect, it } from "vitest";
import type { SavedGame } from "narraleaf-react";
import { DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION } from "@shared/types/saveCompatibility";
import { translate } from "@/lib/i18n";
import {
    isRowLaunchSave,
    loadSaveIntoGame,
    readSaveSceneIds,
    type SaveLoadGameSeam,
    type SaveRelaunchTarget,
    type SaveStoryTarget,
} from "./saveLoad";

/**
 * Loading a save into a Dev Mode session, whatever row or scene that session was started from.
 *
 * The ids below are the ones the story compiler stamps (`nl:scene:<id>`, `studio:<story>:<scene>:
 * <row>:...`), and the launch ids are the ones it gives the opening scene of a row-precise launch -
 * so these cases fail the way the running game did: a row launch's tables have neither the scene
 * it was launched in nor any scene before it, and a save written inside it names a scene no other
 * compile has.
 */

const STORY = "story-1";

/** What a plain compile entered at the corridor can reach: the corridor and the club room. */
const PLAIN_TABLES = {
    elements: [
        "nl:scene:corridor", "nl:scene:corridor:layer:background", "nl:scene:corridor:layer:displayable",
        "nl:scene:club", "nl:scene:club:layer:background", "nl:scene:club:layer:displayable",
        "nl:image:club:narra",
    ],
    actions: [`studio:${STORY}:corridor:c1:t1:0`, `studio:${STORY}:club:r5:t5:0`],
};

const LAUNCH = "nl:launch:club:r3";

/** What a launch of the club room's row 3 reaches: its own opening scene, and nothing before. */
const LAUNCH_TABLES = {
    elements: [`${LAUNCH}:scene`, `${LAUNCH}:scene:layer:background`, `${LAUNCH}:scene:layer:displayable`, `${LAUNCH}:image:narra`],
    actions: [`studio:${STORY}:club:r5:t5:1`],
};

function save(input: { scenes: string[]; layers: Record<string, string[]>; states: string[]; action: string; hash: string }): SavedGame {
    return {
        name: "slot",
        meta: { created: 1, updated: 2, id: "m", lastSentence: "line", lastSpeaker: null, storyHash: input.hash, version: 3 },
        game: {
            store: { game: {} },
            services: {},
            elementStates: input.states.map(id => ({ id, data: {} })),
            stage: {
                scenes: input.scenes.map(sceneId => ({ sceneId, elements: { layers: input.layers } })),
                audio: { sounds: [] },
                videos: [],
                vfx: [],
            },
            stackModel: { items: [{ type: "action", actionType: "character:say", action: input.action }] },
            asyncStackModels: [],
            history: [{ actionId: input.action, element: { type: "say", text: "line" }, snapshot: null }],
        },
    } as unknown as SavedGame;
}

/** Written in a plain session: the club room on stage, the corridor among the element states. */
const PLAIN_SAVE = save({
    scenes: ["nl:scene:club"],
    layers: { "nl:scene:club:layer:displayable": ["nl:image:club:narra"] },
    states: ["nl:scene:corridor", "nl:scene:club", "nl:image:club:narra"],
    action: `studio:${STORY}:club:r5:t5:0`,
    hash: "plain",
});

/** Written inside a launch of the club room's row 3, two lines further on. */
const LAUNCH_SAVE = save({
    scenes: [`${LAUNCH}:scene`],
    layers: { [`${LAUNCH}:scene:layer:displayable`]: [`${LAUNCH}:image:narra`] },
    states: [],
    action: `studio:${STORY}:club:r5:t5:1`,
    hash: "launch",
});

function harness(running: "plain" | "launch", options?: { remountStillMissing?: boolean }) {
    let tables = running === "plain" ? PLAIN_TABLES : LAUNCH_TABLES;
    let hash = running;
    const calls = {
        apply: 0,
        restore: 0,
        remount: [] as SaveStoryTarget[],
        relaunch: [] as Omit<SaveRelaunchTarget, "savedGame">[],
        resolveStoryMount: [] as SaveStoryTarget[],
    };
    const reports: string[] = [];
    const game: SaveLoadGameSeam = {
        resolveStoryMaps: () => ({
            hasAction: id => tables.actions.includes(id),
            hasElement: id => tables.elements.includes(id),
        }),
        readStoryHash: () => hash,
        snapshot: () => save({ scenes: [], layers: {}, states: [], action: "", hash }),
        apply: () => {
            calls.apply += 1;
        },
        restore: () => {
            calls.restore += 1;
        },
        // What the host answers: the story is the mounted one, so it is "same" unless the session
        // on the stage was entered through a row launch.
        resolveStoryMount: target => {
            calls.resolveStoryMount.push(target);
            return running === "launch" ? "remount" : "same";
        },
        remountStory: async target => {
            calls.remount.push(target);
            tables = options?.remountStillMissing
                ? { elements: PLAIN_TABLES.elements.filter(id => id !== "nl:scene:corridor"), actions: PLAIN_TABLES.actions }
                : PLAIN_TABLES;
            hash = "plain";
        },
        relaunch: async target => {
            calls.relaunch.push({ storyId: target.storyId, sceneId: target.sceneId, blockId: target.blockId });
            return "row";
        },
    };
    const load = (savedGame: SavedGame) => loadSaveIntoGame({
        id: "slot-1",
        readRecord: async () => ({ savedGame }),
        game,
        build: null,
        compatibilityConfig: { ...DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION },
        notifyPlayer: () => {},
        report: (_level, message) => reports.push(message),
    });
    return { calls, reports, load };
}

describe("loading a save into a session started from a row", () => {
    it("mounts the story again and loads a save written outside the launch", async () => {
        const run = harness("launch");

        const outcome = await run.load(PLAIN_SAVE);

        expect(outcome).toMatchObject({ status: "loaded", applied: "save", origin: "sameStory" });
        expect(run.calls.remount).toHaveLength(1);
        // The host is told every scene the save needs, not only the one on stage.
        expect([...run.calls.remount[0].sceneIds].sort()).toEqual(["club", "corridor"]);
        expect(run.calls.apply).toBe(1);
        expect(run.calls.relaunch).toEqual([]);
        expect(run.reports).toEqual([]);
    });

    it("puts the run back when the save still names something after the remount", async () => {
        const run = harness("launch", { remountStillMissing: true });

        const outcome = await run.load(PLAIN_SAVE);

        expect(outcome).toMatchObject({ status: "refused", reason: "unresolved", game: "restored" });
        expect(run.calls.restore).toBe(1);
        expect(run.calls.apply).toBe(0);
    });

    it("applies a save written in that same launch as it was written", async () => {
        const run = harness("launch");

        const outcome = await run.load(LAUNCH_SAVE);

        expect(outcome).toMatchObject({ status: "loaded", applied: "save" });
        expect(run.calls.apply).toBe(1);
        expect(run.calls.remount).toEqual([]);
        expect(run.calls.relaunch).toEqual([]);
    });
});

describe("loading a save written in a run started from a row, anywhere else", () => {
    it("starts the story again on the line the save records", async () => {
        const run = harness("plain");

        const outcome = await run.load(LAUNCH_SAVE);

        expect(outcome).toMatchObject({ status: "loaded", applied: "row" });
        expect(run.calls.relaunch).toEqual([{ storyId: STORY, sceneId: "club", blockId: "r5" }]);
        expect(run.calls.apply).toBe(0);
        // Nothing is mounted for it first: no plain compile has the scene it was written in.
        expect(run.calls.resolveStoryMount).toEqual([]);
        expect(run.calls.remount).toEqual([]);
        expect(run.reports).toEqual([translate("game.saveLoad.rowLaunchRelaunchedRow", { id: "slot-1" })]);
    });
});

describe("what a save names", () => {
    it("reads every scene of the document the save needs, from its stage, its element states and its stack", () => {
        expect(readSaveSceneIds(PLAIN_SAVE).sort()).toEqual(["club", "corridor"]);
    });

    it("names no scene for a launch's own ids, which are not scenes of the document", () => {
        expect(readSaveSceneIds(LAUNCH_SAVE)).toEqual(["club"]);
    });

    it("tells a save written in a row launch from one written anywhere else", () => {
        expect(isRowLaunchSave(LAUNCH_SAVE)).toBe(true);
        expect(isRowLaunchSave(PLAIN_SAVE)).toBe(false);
        // Left behind among the element states once the launch's opening scene has handed over.
        const afterTheLaunch = save({
            scenes: ["nl:scene:light"],
            layers: {},
            states: [`${LAUNCH}:scene`],
            action: `studio:${STORY}:light:l1:t1:0`,
            hash: "launch",
        });
        expect(isRowLaunchSave(afterTheLaunch)).toBe(true);
    });
});
