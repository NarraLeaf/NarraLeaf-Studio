import { describe, expect, it } from "vitest";
import { parseProjectStats } from "./stats";

/**
 * The stored build ledger is rebuilt field by field on every read, so a field the parser does not
 * name is dropped on the way back out - it would be written, survive the session, and vanish the
 * next time Studio opened. These pin the two that say what a finished run produced.
 */
describe("project stats build records", () => {
    const storedRun = (extra: Record<string, unknown>) => ({
        version: 1,
        firstSeenAt: 1,
        lastActiveAt: 2,
        days: {},
        builds: [{ startedAt: 1, finishedAt: 2, durationMs: 1, ok: true, ...extra }],
    });

    it("keeps the variant and the output directory of a finished run", () => {
        const parsed = parseProjectStats(storedRun({
            variant: "Demo",
            outputDir: "D:\\games\\my-title\\release",
        }));
        expect(parsed?.builds[0]).toMatchObject({
            variant: "Demo",
            outputDir: "D:\\games\\my-title\\release",
        });
    });

    it("drops a blank or absent variant and output directory rather than storing an empty answer", () => {
        // A run that failed before it resolved a variant, and every record written before these were
        // kept: the row says nothing instead of saying the edition was "".
        const blank = parseProjectStats(storedRun({ variant: "  ", outputDir: "" }));
        expect(blank?.builds[0]).not.toHaveProperty("variant");
        expect(blank?.builds[0]).not.toHaveProperty("outputDir");

        const absent = parseProjectStats(storedRun({}));
        expect(absent?.builds[0]).not.toHaveProperty("variant");
        expect(absent?.builds[0]).not.toHaveProperty("outputDir");
    });

    it("ignores values of the wrong type, the way every other stored field is treated", () => {
        const parsed = parseProjectStats(storedRun({ variant: 7, outputDir: ["a"] }));
        expect(parsed?.builds[0]).not.toHaveProperty("variant");
        expect(parsed?.builds[0]).not.toHaveProperty("outputDir");
    });
});
