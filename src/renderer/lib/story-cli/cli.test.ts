import { describe, expect, it } from "vitest";
import { parseArgs, runCli } from "./cli";

/**
 * The command surface: what a mistyped invocation is told, and what a correct one answers.
 *
 * The point of the refusals is that they are refusals. Both used to pass silently in the sibling
 * tools - `--projct` reported that `--project` was missing while the path sat on the line, and an
 * unknown enum value answered for something else with nothing to say it had - and each one cost a
 * run that looked like it had worked.
 */

async function runAsync(argv: string[]): Promise<{ code: number; out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(argv, { out: text => out.push(text), err: text => err.push(text) });
    return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("the story command surface", () => {
    it("answers a bare invocation with usage, and calls it a mistake", async () => {
        const asked = await runAsync(["--help"]);
        expect(asked.code).toBe(0);
        expect(asked.out).toContain("story - query the command catalogue");

        // Being given nothing at all is not a question, so it is not a success.
        expect((await runAsync([])).code).toBe(2);
    });

    it("refuses a command it does not have, and guesses at the one meant", async () => {
        const result = await runAsync(["comand"]);
        expect(result.code).toBe(2);
        expect(result.err).toContain('Unknown command "comand"');
        expect(result.err).toContain('Did you mean "command"?');
    });

    it("refuses a flag the command does not declare", async () => {
        // The failure this exists for: `--projct` silently ignored, then "needs --project" reported
        // with the path sitting on the line.
        const result = await runAsync(["commands", "--projct", "D:/somewhere"]);
        expect(result.code).toBe(2);
        expect(result.err).toContain('Unknown flag "--projct"');
    });

    it("refuses a category that is not one of the ones there are", async () => {
        const result = await runAsync(["commands", "--category", "sounds"]);
        expect(result.code).toBe(2);
        expect(result.err).toContain('"--category sounds" is not one of');
    });

    it("says which project a command needs rather than reading the working directory", async () => {
        const result = await runAsync(["scenes"]);
        expect(result.code).toBe(2);
        expect(result.err).toContain('"scenes" needs --project');
    });

    it("finds a command by token, by id, and by a search that leaves one standing", async () => {
        for (const query of ["bg", "background", "/bg"]) {
            const result = await runAsync(["command", query]);
            expect(result.code, query).toBe(0);
            expect(result.out, query).toContain("id         background");
        }
    });

    it("suggests near misses for a command that does not exist", async () => {
        const result = await runAsync(["command", "backgrund"]);
        expect(result.code).toBe(2);
        expect(result.err).toContain("Close by:");
        // The alias, not the token: `backgrund` is one edit from `background` and six from `bg`.
        expect(result.err).toContain("background");
    });

    it("prints the line shapes that are not commands", async () => {
        const result = await runAsync(["lines"]);
        expect(result.code).toBe(0);
        // The one rule an agent has to know before writing a line, and the one that keeps a broken
        // command from turning into narration.
        expect(result.out).toContain("A line opening with / is always a command");
    });

    it("reads a flag written with an equals sign and one written apart", () => {
        expect(parseArgs(["show", "--project=D:/x", "--out"], new Set())).toEqual({
            command: "show",
            positional: [],
            flags: { project: "D:/x", out: true },
        });
        expect(parseArgs(["check", "a.story", "--project", "D:/x"], new Set())).toEqual({
            command: "check",
            positional: ["a.story"],
            flags: { project: "D:/x" },
        });
    });
});
