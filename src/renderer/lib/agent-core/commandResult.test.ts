/**
 * A command's output comes out in the order the command said it, and a command that throws still
 * says what it had said.
 *
 * The defect these pin: when the command bodies began returning their output instead of printing
 * it, the command line wrote all of stderr and then all of stdout, so `Nothing written.` landed above
 * the diagnostics it follows in a terminal; and a body that threw partway lost everything it had
 * written - `story stories` over a project with one unreadable story printed only the error (that
 * case is held in `story-cli/checkUnreadable.test.ts`).
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { runCli as runStoryCli } from "@/lib/story-cli/cli";
import { runCli as runUiCli } from "@/lib/ui-cli/cli";
import { commandWriter, emitCommandResult, emitPartialOutput, type CommandIo } from "./commandResult";
import { applyUiSource, readableBlueprintDocument, showUi, type UiAgentContext } from "./index";

const SKELETON = path.resolve(__dirname, "../../../../resources/templates/skeleton/content");

/** One log for both streams, the way a terminal shows them. */
function terminal(): { io: CommandIo; log: string[] } {
    const log: string[] = [];
    return { io: { out: text => log.push(`out ${text}`), err: text => log.push(`err ${text}`) }, log };
}

function readJson<T>(relative: string): T {
    return JSON.parse(fs.readFileSync(path.join(SKELETON, relative), "utf8")) as T;
}

function uiContext(): UiAgentContext {
    return {
        document: readJson<UIDocument>("editor/ui/uidoc.json"),
        blueprintDocument: readableBlueprintDocument(readJson<{ blueprintDocument: BlueprintDocument }>("editor/ui/uigraphs.json").blueprintDocument),
        textKeys: null,
    };
}

let scratch = "";

beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nls-command-result-"));
});

afterAll(() => {
    if (scratch) {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
});

describe("a command result", () => {
    it("replays its writes in the order the body made them, each on its own stream", () => {
        const io = commandWriter();
        io.out("first");
        io.err("second");
        io.out("third");
        const result = io.finish(1);
        expect(result.out).toEqual(["first", "third"]);
        expect(result.err).toEqual(["second"]);
        const { io: sink, log } = terminal();
        expect(emitCommandResult(result, sink)).toBe(1);
        expect(log).toEqual(["out first", "err second", "out third"]);
    });

    it("hangs what was written on an error a guarded call throws, and says it once", () => {
        const io = commandWriter();
        io.out("listed");
        io.err("noted");
        const failure = new Error("unreadable");
        expect(() => io.guard(() => {
            throw failure;
        })).toThrow(failure);
        const { io: sink, log } = terminal();
        emitPartialOutput(failure, sink);
        emitPartialOutput(failure, sink);
        expect(log).toEqual(["out listed", "err noted"]);

        // A guarded call that returns hands its value back; an error no guard saw carries nothing.
        expect(io.guard(() => 42)).toBe(42);
        emitPartialOutput(new Error("elsewhere"), sink);
        emitPartialOutput("not an object", sink);
        expect(log).toHaveLength(2);
    });

    it("keeps an outer body's writes ahead of an inner one's when both guard the same error", () => {
        const outer = commandWriter();
        outer.out("outer");
        const failure = new Error("deep");
        expect(() => outer.guard(() => {
            const inner = commandWriter();
            inner.out("inner");
            return inner.guard(() => {
                throw failure;
            });
        })).toThrow(failure);
        const { io: sink, log } = terminal();
        emitPartialOutput(failure, sink);
        expect(log).toEqual(["out outer", "out inner"]);
    });
});

describe("the command lines say it in order", () => {
    it("story apply of a broken file prints its diagnostics before \"Nothing written.\"", async () => {
        const shown = terminal();
        expect(await runStoryCli(["show", "--project", SKELETON], shown.io)).toBe(0);
        // A row no command answers to, first in the body: after the header and its blank line.
        const text = shown.log[0].slice("out ".length).replace("\n\n", "\n\n/nosuchcommand at all\n");
        const file = path.join(scratch, "broken.story");
        fs.writeFileSync(file, text, "utf8");

        const { io, log } = terminal();
        expect(await runStoryCli(["apply", file, "--project", SKELETON], io)).toBe(1);
        const diagnostics = log.findIndex(line => line.startsWith("out ") && line.includes("nosuchcommand"));
        expect(diagnostics).toBeGreaterThanOrEqual(0);
        expect(log.indexOf("err Nothing written.")).toBeGreaterThan(diagnostics);
    });

    it("ui apply of a broken file prints its diagnostics before \"Nothing written.\"", () => {
        const file = path.join(scratch, "broken.ui");
        fs.writeFileSync(file, "surface Broken {\n  NoSuchWidget nosuch {\n", "utf8");
        const { io, log } = terminal();
        expect(runUiCli(["apply", file, "--project", SKELETON], io)).toBe(1);
        expect(log[0]).toMatch(/^out /);
        expect(log[log.length - 1]).toBe("err Nothing written.");
    });
});

describe("ui apply keeps the change through commit, before it says so", () => {
    function cleanSurface(context: UiAgentContext): string {
        return showUi(context, { surface: context.document.surfaces[0].name }).text as string;
    }

    it("leaves with 2 and never says \"Written.\" when commit refuses", () => {
        const context = uiContext();
        const result = applyUiSource(cleanSurface(context), context, { write: true, commit: () => "The disk said no." });
        expect(result.exitCode).toBe(2);
        expect(result.writes[result.writes.length - 1]).toEqual({ stream: "err", text: "The disk said no." });
        expect(result.out.join("\n")).not.toContain("Written.");
    });

    it("still says the diagnostics when commit throws", () => {
        const context = uiContext();
        const failure = new Error("EPERM");
        expect(() => applyUiSource(cleanSurface(context), context, {
            write: true,
            commit: () => {
                throw failure;
            },
        })).toThrow(failure);
        const { io, log } = terminal();
        emitPartialOutput(failure, io);
        expect(log.length).toBeGreaterThan(0);
        expect(log.join("\n")).not.toContain("Written.");
    });
});
