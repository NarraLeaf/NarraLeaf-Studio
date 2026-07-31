import { beforeEach, describe, expect, it } from "vitest";
import { clearConsoleBuffer, getConsoleBufferLines, recordConsoleEntry } from "./consoleBuffer";

describe("console buffer", () => {
    beforeEach(() => {
        clearConsoleBuffer();
    });

    it("formats a level, a timestamp and the joined arguments", () => {
        recordConsoleEntry("error", ["Failed to initialize workspace:", "give up"]);

        const [line] = getConsoleBufferLines();

        expect(line).toContain("[ERROR]");
        expect(line).toContain("Failed to initialize workspace: give up");
        expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("keeps an error's stack, which is the reason to read this at all", () => {
        const error = new Error("nope");
        error.stack = "Error: nope\n    at boot (app://studio/index.js:2:2)";

        recordConsoleEntry("error", [error]);

        expect(getConsoleBufferLines()[0]).toContain("at boot (app://studio/index.js:2:2)");
    });

    it("survives a circular object instead of throwing inside a log call", () => {
        const circular: Record<string, unknown> = { name: "loop" };
        circular.self = circular;

        recordConsoleEntry("log", [circular]);

        expect(getConsoleBufferLines()[0]).toContain("circular");
    });

    it("drops the oldest lines once it is full", () => {
        for (let index = 0; index < 500; index++) {
            recordConsoleEntry("log", [`line-${index}`]);
        }

        const lines = getConsoleBufferLines();

        expect(lines).toHaveLength(400);
        expect(lines[0]).toContain("line-100");
        expect(lines[lines.length - 1]).toContain("line-499");
    });

    it("caps one enormous entry so it cannot evict the rest", () => {
        recordConsoleEntry("log", ["x".repeat(10_000)]);

        const [line] = getConsoleBufferLines();

        expect(line.length).toBeLessThan(4_200);
        expect(line).toContain("more chars");
    });
});
