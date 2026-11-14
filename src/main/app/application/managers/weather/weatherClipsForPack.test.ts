import { describe, expect, it, vi } from "vitest";
import { Fs } from "@shared/utils/fs";
import { bakeWeatherClipsForPack } from "./weatherClipsForPack";
import type { WeatherBakeManager } from "./WeatherBakeManager";

vi.mock("@shared/weather/stage", () => ({
    collectWeatherSpecs: () => [{ ref: { seed: "snow" }, width: 64, height: 36, fps: 30, frames: 1 }],
    weatherClipAssetId: () => "snow",
}));

describe("bakeWeatherClipsForPack", () => {
    it("does not submit weather after cancellation before project reads", async () => {
        const manager = {
            abandon: vi.fn(),
            ensure: vi.fn().mockResolvedValue({ paths: new Map(), failures: new Map() }),
        };

        const result = await bakeWeatherClipsForPack(manager as unknown as WeatherBakeManager, "/nonexistent/project", {
            threads: null,
            onStart: abandon => abandon(),
        });

        expect(result).toEqual([]);
        expect(manager.abandon).toHaveBeenCalledOnce();
        expect(manager.ensure).not.toHaveBeenCalled();
    });

    it("does not submit weather after cancellation during project reads", async () => {
        const manager = {
            abandon: vi.fn(),
            ensure: vi.fn().mockResolvedValue({ paths: new Map(), failures: new Map() }),
        };
        let releaseRead: (value: unknown) => void = () => undefined;
        const read = new Promise(resolve => { releaseRead = resolve; });
        const readSpy = vi.spyOn(Fs, "read").mockImplementationOnce(() => read as never);
        let abandon = () => {};
        try {
            const pending = bakeWeatherClipsForPack(manager as unknown as WeatherBakeManager, "/nonexistent/project", {
                threads: null,
                onStart: cancel => { abandon = cancel; },
            });

            expect(readSpy).toHaveBeenCalledOnce();
            abandon();
            releaseRead({ ok: false });

            expect(await pending).toEqual([]);
            expect(manager.abandon).toHaveBeenCalledOnce();
            expect(manager.ensure).not.toHaveBeenCalled();
        } finally {
            readSpy.mockRestore();
        }
    });
});
