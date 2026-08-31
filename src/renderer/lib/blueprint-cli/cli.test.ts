/**
 * How the command line behaves when it is typed wrong, which is most of the time.
 *
 * Every case here was silent before it was a test. A misspelled flag was dropped on the floor and
 * the command then complained about the flag it had not been given; `--owner widget` answered for
 * `globalMain`; `apply --write my.bp` read the filename as the value of `--write` and reported that
 * no file was given. None of them failed - they all answered, wrongly, which costs more than a
 * refusal does.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { parseArgs, runCli } from "./cli";

function run(...argv: string[]): { code: number; out: string; err: string } {
    const out: string[] = [];
    const err: string[] = [];
    const code = runCli(argv, { out: text => out.push(text), err: text => err.push(text) });
    return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("parseArgs", () => {
    it("does not let a boolean flag eat the argument after it", () => {
        const args = parseArgs(["apply", "--write", "my.bp"], new Set(["write"]));
        expect(args.flags.write).toBe(true);
        expect(args.positional).toEqual(["my.bp"]);
    });

    it("still reads a value flag written either way", () => {
        expect(parseArgs(["list", "--project", "D:/x"]).flags.project).toBe("D:/x");
        expect(parseArgs(["list", "--project=D:/x"]).flags.project).toBe("D:/x");
    });
});

describe("the command line", () => {
    it("refuses a flag the command does not take, and guesses at the one meant", () => {
        const result = run("list", "--projct", "D:/x");
        expect(result.code).toBe(2);
        expect(result.err).toContain("--projct");
        expect(result.err).toContain('Did you mean "project"?');
    });

    it("refuses a value that is not one of the ones there are", () => {
        const result = run("nodes", "--owner", "widget");
        expect(result.code).toBe(2);
        expect(result.err).toContain("widgetMain");
        expect(result.err).toContain("componentWidgetMain");
    });

    it("answers to the name the palette shows", () => {
        const result = run("node", "Play Sound");
        expect(result.code).toBe(0);
        expect(result.out).toContain("blueprint.sound.play");
        expect(result.err).toContain("-> blueprint.sound.play");
    });

    it("says how many nodes it did not print", () => {
        const result = run("nodes");
        expect(result.code).toBe(0);
        expect(result.out).toMatch(/60 of \d{3} nodes/);
        expect(result.out).toContain("--limit 0");
    });

    it("prints all of them when asked", () => {
        const result = run("nodes", "--limit", "0");
        expect(result.out).not.toContain("--limit 0 for all");
    });

    it("tells help from being given nothing", () => {
        expect(run("--help").code).toBe(0);
        expect(run().code).toBe(2);
    });

    it("suggests a command when one is close", () => {
        const result = run("noeds");
        expect(result.code).toBe(2);
        expect(result.err).toContain('Did you mean "nodes"?');
    });

    it("will not guess which project", () => {
        const result = run("list");
        expect(result.code).toBe(2);
        expect(result.err).toContain("--project");
    });
});
