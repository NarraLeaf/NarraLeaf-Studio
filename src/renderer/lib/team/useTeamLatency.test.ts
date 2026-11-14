import { describe, expect, it } from "vitest";

import { medianOf, teamLatencyTone } from "./useTeamLatency";

describe("the latency figure", () => {
    it("is the middle of the samples, so one slow answer does not move it", () => {
        expect(medianOf([20, 22, 900, 21, 23])).toBe(22);
        expect(medianOf([12.4])).toBe(12);
    });

    it("reads on the same steps as the server's console", () => {
        expect(teamLatencyTone(30)).toBe("ok");
        expect(teamLatencyTone(149)).toBe("ok");
        expect(teamLatencyTone(150)).toBe("slow");
        expect(teamLatencyTone(399)).toBe("slow");
        expect(teamLatencyTone(400)).toBe("bad");
    });
});
