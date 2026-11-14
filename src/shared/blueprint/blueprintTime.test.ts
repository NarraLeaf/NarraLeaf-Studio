import { describe, expect, it } from "vitest";
import { addBlueprintTime, blueprintTimeParts, makeBlueprintTime } from "./blueprintTime";

function localTime(year: number, month: number, day: number): number {
    const date = new Date(2000, 0, 1, 12);
    date.setFullYear(year, month - 1, day);
    return date.getTime();
}

describe("early calendar years", () => {
    it("rolls Make Time fields across years 0 to 99", () => {
        expect(blueprintTimeParts(makeBlueprintTime({ year: 50, month: 13, day: 1 })))
            .toMatchObject({ year: 51, month: 1, day: 1, dayOfYear: 1 });
        expect(blueprintTimeParts(makeBlueprintTime({ year: 0, month: 2, day: 29 })))
            .toMatchObject({ year: 0, month: 2, day: 29, dayOfYear: 60 });
    });

    it("reports the day of the local calendar year", () => {
        expect(blueprintTimeParts(localTime(50, 1, 1)).dayOfYear).toBe(1);
        expect(blueprintTimeParts(localTime(0, 12, 31)).dayOfYear).toBe(366);
    });

    it("clamps a month shift using the leap year of the target", () => {
        expect(blueprintTimeParts(addBlueprintTime(localTime(0, 1, 31), 1, "months")))
            .toMatchObject({ year: 0, month: 2, day: 29 });
    });
});
