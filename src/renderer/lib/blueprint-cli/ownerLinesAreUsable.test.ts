/**
 * The `owner=` lines the tools print are lines `blueprint apply` reads.
 *
 * That is the seam the documented workflow rests on: `ui surfaces` and `blueprint targets` exist to
 * be read for the owner of the thing you want to write a graph for, and the guide says so - "the
 * `owner=` lines are the ones `blueprint apply` wants". Nothing held them to it. Both commands build
 * their lines by hand, one template string per owner kind, while the reader is built from
 * `BLUEPRINT_OWNER_GRAMMAR` - so a field renamed on one side leaves the other printing a line that
 * looks right and is refused.
 *
 * The two directions are checked separately on purpose. That a line parses says the field names are
 * accepted; that it compiles to the same kind says they were understood as the owner it named, which
 * is the half a rename would still pass.
 *
 * Comments in English per project convention.
 */

import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { registerBuiltInPluginBlueprintNodes } from "./builtinPluginNodes";
import { runCli as runBlueprintCli } from "./cli";
import { runCli as runUiCli } from "@/lib/ui-cli/cli";
import { compileBlueprintDocument } from "./dsl/compile";
import { parseBlueprintText } from "./dsl/parse";

registerCoreBlueprintNodes();
// The shipped skeleton's EXTRA screen is built on the Gallery plugin's nodes, and the CLI
// registers every bundled plugin's the same way. Without this the skeleton reads here as a
// document full of unknown types.
registerBuiltInPluginBlueprintNodes();

const SKELETON = path.resolve(__dirname, "../../../../resources/templates/skeleton/content");

function capture(cli: typeof runBlueprintCli, argv: string[]): string {
    let out = "";
    cli(argv, {
        out: text => {
            out += `${text}\n`;
        },
        err: () => undefined,
    });
    return out;
}

/**
 * The `owner=…` part of every line that carries one, up to the trailing `#` label.
 *
 * `ui surfaces` writes a comment after the fields to say which element the line is for, and a `.bp`
 * file drops it - so the comment is cut here rather than fed to the reader, which is exactly what a
 * person copying the line does.
 */
function ownerLines(output: string): string[] {
    const lines: string[] = [];
    for (const raw of output.split("\n")) {
        const at = raw.indexOf("owner=");
        if (at < 0) {
            continue;
        }
        const hash = raw.indexOf("#", at);
        lines.push((hash < 0 ? raw.slice(at) : raw.slice(at, hash)).trim());
    }
    return lines;
}

function compileOwnerLine(line: string) {
    const parsed = parseBlueprintText(`blueprint Probe ${line}\n`);
    const compiled = compileBlueprintDocument(parsed.document, { newId: () => "bp-probe" });
    const errors = [...parsed.diagnostics, ...compiled.diagnostics]
        .filter(item => item.severity === "error")
        .map(item => `${item.code} ${item.message}`);
    return { owner: compiled.blueprints[0]?.owner, errors };
}

const SOURCES = [
    { name: "ui surfaces", output: () => capture(runUiCli, ["surfaces", "--project", SKELETON]) },
    { name: "blueprint targets", output: () => capture(runBlueprintCli, ["targets", "--project", SKELETON]) },
];

describe.each(SOURCES)("the owner lines $name prints", source => {
    it("prints some, so the rest of this is not vacuous", () => {
        // The shipped skeleton has a couple of hundred slots across surfaces and components. A
        // command that printed nothing would pass every assertion below without meaning anything.
        expect(ownerLines(source.output()).length).toBeGreaterThan(20);
    });

    it("are all lines the reader accepts", () => {
        const refused = ownerLines(source.output())
            .map(line => ({ line, errors: compileOwnerLine(line).errors }))
            .filter(result => result.errors.length > 0)
            .map(result => `${result.line} -> ${result.errors.join("; ")}`);

        expect(refused).toEqual([]);
    });

    it("name the owner kind they say they do", () => {
        // Parsing is not enough: `surface=` renamed on one side and not the other would still read,
        // as an owner missing a field - and a missing field is a different owner.
        const mismatched = ownerLines(source.output())
            .map(line => ({ line, kind: compileOwnerLine(line).owner?.kind }))
            .filter(result => !result.line.startsWith(`owner=${result.kind} `)
                && result.line !== `owner=${result.kind}`)
            .map(result => `${result.line} -> ${result.kind ?? "nothing"}`);

        expect(mismatched).toEqual([]);
    });

    it("covers more than one owner kind", () => {
        // A guard that only ever saw `widgetMain` would say nothing about the component and surface
        // spellings, which are the ones with different field names.
        const kinds = new Set(ownerLines(source.output()).map(line => compileOwnerLine(line).owner?.kind));
        expect(kinds.size).toBeGreaterThan(1);
    });
});
