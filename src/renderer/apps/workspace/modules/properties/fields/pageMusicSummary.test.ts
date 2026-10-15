import { describe, expect, it } from "vitest";
import { pageMusicSummary, type PageMusicSummaryInput } from "./pageMusicSummary";

/** Echoes a key with its arguments, so the test reads which phrase was chosen and with what. */
const t = ((key: string, args?: Record<string, unknown>) =>
    args ? `${key}(${Object.entries(args).map(([name, value]) => `${name}=${value}`).join(",")})` : key) as never;

const base: PageMusicSummaryInput = { volume: 1, trackName: "Music", loops: true, region: null, fadeMs: 0 };

describe("page music summary", () => {
    it("opens as an element sound's line does, volume then track", () => {
        expect(pageMusicSummary(t, { ...base, volume: 0.6 }).split(" · ")[0])
            .toBe("properties.interactionSound.summary(volume=0.6,track=Music)");
    });

    it("says a clip with no marks loops whole", () => {
        expect(pageMusicSummary(t, base).split(" · ")[1]).toBe("properties.pageMusic.loops");
    });

    it("says what repeats when the clip has a loop point and an out point, the intro before it implied", () => {
        const line = pageMusicSummary(t, { ...base, region: { loopStartMs: 12800, outMs: 112000 } });
        expect(line.split(" · ")[1]).toBe("properties.pageMusic.loopRegion(from=12.8,to=112)");
    });

    it("loops from the in point when there is no loop point", () => {
        const line = pageMusicSummary(t, { ...base, region: { inMs: 2000, outMs: 60000 } });
        expect(line.split(" · ")[1]).toBe("properties.pageMusic.loopRegion(from=2,to=60)");
    });

    it("says a loop point with no out point repeats to the end of the file", () => {
        const line = pageMusicSummary(t, { ...base, region: { loopStartMs: 12800 } });
        expect(line.split(" · ")[1]).toBe("properties.pageMusic.loopToEnd(from=12.8)");
    });

    it("says a clip that only carries a gain loops whole", () => {
        expect(pageMusicSummary(t, { ...base, region: { gainDb: -3 } }).split(" · ")[1]).toBe("properties.pageMusic.loops");
    });

    it("says music that does not loop plays once, whatever its marks", () => {
        const line = pageMusicSummary(t, { ...base, loops: false, region: { loopStartMs: 12800, outMs: 112000 } });
        expect(line.split(" · ")[1]).toBe("properties.pageMusic.once");
    });

    it("names a fade only when there is one", () => {
        expect(pageMusicSummary(t, base).split(" · ")).toHaveLength(2);
        expect(pageMusicSummary(t, { ...base, fadeMs: 1200 }).split(" · ")[2]).toBe("properties.pageMusic.fadeSummary(seconds=1.2)");
        expect(pageMusicSummary(t, { ...base, fadeMs: 2000 }).split(" · ")[2]).toBe("properties.pageMusic.fadeSummary(seconds=2)");
    });
});
