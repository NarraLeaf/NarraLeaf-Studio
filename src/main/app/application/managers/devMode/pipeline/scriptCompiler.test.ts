import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { fileURLToPath } from "url";
import { collectScriptRefs, compileProjectScripts } from "./scriptCompiler";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { scriptLayerKey } from "@shared/blueprint/blueprintLayers";

/** The one layer each fixture blueprint holds. Compiled scripts are keyed by blueprint AND layer. */
const LAYER_ID = "layer-script";
const layerKey = (blueprintId: string) => scriptLayerKey(blueprintId, LAYER_ID);

/**
 * Compiling the author's scripts, against real files and the real bundler.
 *
 * The bundler is not stubbed here, because what is being checked is the part a stub would decide:
 * that TypeScript is stripped rather than checked, that an author's own import is followed, and
 * that a file which cannot be compiled reports rather than throws. Each of those is an esbuild
 * behaviour this feature depends on, so asserting them against a fake would assert nothing.
 */

let projectPath: string;

/** Where the compiled modules go; a real directory, because they are real files now. */
function outputDir(): { directory: string } {
    return { directory: path.join(projectPath, ".nlstudio", "dev-mode", "scripts") };
}

/** The compiled module's text, read back from the file the compiler wrote. */
async function compiledText(url: string | undefined): Promise<string> {
    return url ? fs.readFile(fileURLToPath(url), "utf-8") : "";
}

beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "nl-scripts-"));
    await fs.mkdir(path.join(projectPath, "scripts"), { recursive: true });
});

afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true });
});

async function writeScript(relative: string, contents: string): Promise<void> {
    const full = path.join(projectPath, ...relative.split("/"));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents, "utf-8");
}

function documentWith(scripts: Record<string, string>): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        ownerRecords: {},
        blueprints: Object.fromEntries(
            Object.entries(scripts).map(([blueprintId, scriptRef]) => [
                blueprintId,
                {
                    id: blueprintId,
                    name: blueprintId,
                    owner: { kind: "globalMain" as const },
                    graphs: {
                        eventIds: [LAYER_ID],
                        events: { [LAYER_ID]: { id: LAYER_ID, script: { scriptRef } } },
                        functions: {},
                    },
                },
            ]),
        ),
    } as BlueprintDocument;
}

describe("compiling script blueprints", () => {
    it("finds the file each script blueprint names, and ignores graph blueprints", () => {
        const document = documentWith({ "bp-1": "scripts/a.ts" });
        document.blueprints["bp-graph"] = {
            id: "bp-graph",
            name: "Graph",
            owner: { kind: "globalMain" },
            graphs: { events: {}, functions: {} },
        };
        expect([...collectScriptRefs(document)]).toEqual([[layerKey("bp-1"), "scripts/a.ts"]]);
    });

    it("strips types rather than checking them, so a wrong type still runs", async () => {
        // The invariant this whole feature rests on: a build never depends on a type check passing.
        // `tsc` is a lint the author reads in their editor, never a step in this pipeline.
        await writeScript("scripts/wrong.ts", [
            "const n: number = \"not a number\";",
            "export function onAppBoot() { return n; }",
        ].join("\n"));

        const compiled = await compileProjectScripts(projectPath, documentWith({ "bp-1": "scripts/wrong.ts" }), outputDir());

        expect(compiled[layerKey("bp-1")].diagnostics).toBeUndefined();
        expect(await compiledText(compiled[layerKey("bp-1")].url)).toContain("onAppBoot");
    });

    it("bundles what the author imported", async () => {
        await writeScript("scripts/helper.ts", "export const greeting = \"from the helper\";");
        await writeScript("scripts/main.ts", [
            'import { greeting } from "./helper";',
            "export function onAppBoot() { return greeting; }",
        ].join("\n"));

        const compiled = await compileProjectScripts(projectPath, documentWith({ "bp-1": "scripts/main.ts" }), outputDir());

        expect(await compiledText(compiled[layerKey("bp-1")].url)).toContain("from the helper");
    });

    it("erases the type-only import of the declarations, which resolve to no package", async () => {
        // The declarations are an ambient module: nothing is installed for them, so a value import
        // would fail to resolve. `import type` is erased before the bundler looks.
        await writeScript("scripts/typed.ts", [
            'import type { GlobalCtx } from "@narraleaf/script";',
            "export function onAppBoot(ctx: GlobalCtx) { return ctx; }",
        ].join("\n"));

        const compiled = await compileProjectScripts(projectPath, documentWith({ "bp-1": "scripts/typed.ts" }), outputDir());

        expect(compiled[layerKey("bp-1")].diagnostics).toBeUndefined();
        expect(await compiledText(compiled[layerKey("bp-1")].url)).not.toContain("@narraleaf/script");
    });

    it("reports a file that will not compile, and keeps compiling the others", async () => {
        await writeScript("scripts/broken.ts", "export function onAppBoot( {");
        await writeScript("scripts/fine.ts", "export function onAppBoot() {}");

        const compiled = await compileProjectScripts(projectPath, documentWith({ "bp-broken": "scripts/broken.ts", "bp-fine": "scripts/fine.ts" }), outputDir());

        // One dead handler and a message naming the file, not a project that will not open.
        expect(compiled[layerKey("bp-broken")].url).toBeUndefined();
        expect(compiled[layerKey("bp-broken")].diagnostics?.[0].message).toContain("scripts/broken.ts");
        expect(await compiledText(compiled[layerKey("bp-fine")].url)).toContain("onAppBoot");
    });

    it("reports a missing file rather than throwing", async () => {
        const compiled = await compileProjectScripts(projectPath, documentWith({ "bp-1": "scripts/gone.ts" }), outputDir());
        expect(compiled[layerKey("bp-1")].url).toBeUndefined();
        expect(compiled[layerKey("bp-1")].diagnostics?.[0].severity).toBe("error");
    });

    it("refuses a path that is not one of this project's scripts", async () => {
        // The document is the author's file and its paths are theirs to write, so a path that is
        // not a script is refused here rather than handed to a bundler pointed at the project root.
        for (const ref of ["editor/story/index.json", "scripts/node_modules/pkg/index.js", "../outside.ts"]) {
            const compiled = await compileProjectScripts(projectPath, documentWith({ "bp-1": ref }), outputDir());
            expect(compiled[layerKey("bp-1")].url, ref).toBeUndefined();
            expect(compiled[layerKey("bp-1")].diagnostics?.[0].message, ref).toContain("not a script");
        }
    });

    it("compiles one file once, however many blueprints name it", async () => {
        await writeScript("scripts/shared.ts", "export function onAppBoot() {}");
        const compiled = await compileProjectScripts(projectPath, documentWith({ "bp-1": "scripts/shared.ts", "bp-2": "scripts/shared.ts" }), outputDir());
        // The same module object, so two blueprints pointing at one script share its module-level
        // state - which is what an author reading one file would expect.
        expect(compiled[layerKey("bp-1")]).toBe(compiled[layerKey("bp-2")]);
    });

    it("refuses every script when the host has nowhere to serve them from", async () => {
        // A URL is the only way a script reaches a page: every host's Content-Security-Policy
        // refuses `blob:` and `data:`, and the shipped one refuses `unsafe-eval` too. A caller that
        // names no output directory therefore gets refusals rather than modules nothing can import.
        await writeScript("scripts/a.ts", "export function onAppBoot() {}");
        const compiled = await compileProjectScripts(projectPath, documentWith({ "bp-1": "scripts/a.ts" }));
        expect(compiled[layerKey("bp-1")].url).toBeUndefined();
        expect(compiled[layerKey("bp-1")].diagnostics?.[0].message).toContain("cannot serve");
    });

    it("does nothing at all for a project with no scripts", async () => {
        expect(await compileProjectScripts(projectPath, documentWith({}), outputDir())).toEqual({});
    });
});
