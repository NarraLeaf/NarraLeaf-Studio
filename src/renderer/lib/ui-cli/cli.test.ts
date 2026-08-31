/**
 * The command surface itself: what stops the run, and what the exit code says.
 *
 * A typo that is silently ignored is worse than one that stops the run, because the report then
 * describes a problem the caller does not have - `--projct` reaching a command as an absent
 * `--project` reads as "this command needs --project" with the path sitting on the line.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { runCli } from "./cli";

function run(...argv: string[]): { code: number; out: string; err: string } {
    let out = "";
    let err = "";
    const code = runCli(argv, {
        out: text => {
            out += `${text}\n`;
        },
        err: text => {
            err += `${text}\n`;
        },
    });
    return { code, out, err };
}

describe("the ui command surface", () => {
    it("prints the usage text and leaves with 2 when given nothing", () => {
        const result = run();
        expect(result.code).toBe(2);
        expect(result.out).toContain("ui - query the widget catalogue");
    });

    it("answers --help with 0", () => {
        expect(run("--help").code).toBe(0);
        expect(run("widgets", "--help").code).toBe(0);
    });

    it("stops on an unknown command and suggests the one that was meant", () => {
        const result = run("widgts");
        expect(result.code).toBe(2);
        expect(result.err).toContain('Did you mean "widgets"?');
    });

    it("stops on a flag the command does not declare", () => {
        const result = run("widgets", "--projct", "x");
        expect(result.code).toBe(2);
        expect(result.err).toContain('Unknown flag "--projct"');
        expect(result.err).toContain("--insertable");
    });

    it("stops on a flag value that is not one of the ones there are", () => {
        const result = run("widgets", "--slot", "sidebar");
        expect(result.code).toBe(2);
        expect(result.err).toContain("is not one of: onStage, dialog");
    });

    it("stops on a string flag given without a value", () => {
        expect(run("structs", "--project").code).toBe(2);
    });

    it("lists widget types", () => {
        const result = run("widgets");
        expect(result.code).toBe(0);
        expect(result.out).toContain("nl.button");
    });

    it("describes one widget type, and suggests a near miss for one that does not exist", () => {
        expect(run("widget", "nl.button").out).toContain("bindable props");
        const missing = run("widget", "nl.buton");
        expect(missing.code).toBe(2);
        expect(missing.err).toContain("Close by: nl.button");
    });

    it("says which command needed a project rather than that some command did", () => {
        expect(run("surfaces").err).toContain('"surfaces" needs --project');
    });

    it("checks a file with no project, and says what it could not check", () => {
        // A path with a directory separator is taken literally, so this reads as a missing file
        // rather than as a name in the scratch directory.
        const result = run("check", "./no-such-file.ui");
        expect(result.code).toBe(2);
        expect(result.err).toContain("Cannot read");
    });
});
