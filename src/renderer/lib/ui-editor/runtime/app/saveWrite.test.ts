import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTO_SAVE_CONFIGURATION } from "@shared/types/saves";
import { AutoSaveScheduler } from "./autoSaveScheduler";
import { serializeGameSave } from "./saveWrite";

describe("autosave snapshot ownership", () => {
    it("does not serialize a superseded playthrough after its requested screenshot finishes", async () => {
        let playthrough = 1;
        let releasePicture = () => undefined as void;
        let pictureStarted = () => undefined as void;
        const started = new Promise<void>(resolve => { pictureStarted = resolve; });
        const picture = new Promise<void>(resolve => { releasePicture = resolve; });
        const oldGame = { serialize: vi.fn(() => "old game") };
        const newGame = { serialize: vi.fn(() => "new game") };
        let game = oldGame;
        const written: string[] = [];
        const scheduler = new AutoSaveScheduler({
            getConfig: () => DEFAULT_AUTO_SAVE_CONFIGURATION,
            isPlaying: () => true,
            playthrough: () => playthrough,
            write: async (_id, reason, captured, isCurrent) => {
                const liveGame = game;
                if (reason === "requested") {
                    pictureStarted();
                    await picture;
                }
                written.push(serializeGameSave(liveGame, captured, isCurrent));
            },
            listStored: async () => [],
            log: () => undefined,
        });

        const saving = scheduler.writeNow();
        const result = saving.then(() => "written", () => "cancelled");
        await started;
        playthrough = 2;
        game = newGame;
        scheduler.markStoryAdvanced();
        releasePicture();

        expect(await result).toBe("cancelled");
        expect(oldGame.serialize).not.toHaveBeenCalled();
        expect(written).toEqual([]);
        await scheduler.tick();
        expect(written).toEqual(["new game"]);
    });
});
