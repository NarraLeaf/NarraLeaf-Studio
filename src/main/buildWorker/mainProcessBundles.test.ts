import fs from "fs";
import os from "os";
import { createRequire } from "module";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BuildOptions } from "esbuild";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { scriptLayerKey } from "@shared/blueprint/blueprintLayers";

const require_ = createRequire(__filename);
const MAIN_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(MAIN_ROOT, "..", "..");
const PIPELINE_DIR = path.join(MAIN_ROOT, "app", "application", "managers", "devMode", "pipeline");

type MainBundles = {
    EVERY_BUNDLE_EXTERNAL: string[];
    MAIN_PROCESS_BUNDLES: Record<string, { entry: string; outfile: string; external: string[] }>;
    mainProcessBundleOptions(name: string, options: { dev: boolean; outDir?: string }): BuildOptions;
};

/** The list both `build-main.js` and `yarn dev` bundle the main process from. */
const bundles = require_(path.join(REPO_ROOT, "project", "build", "main-bundles.js")) as MainBundles;

/*
 * The artifact compile worker bundled esbuild's JavaScript API into itself, which that API refuses:
 * it finds its binary relative to its own `lib/main.js`. Every build, preview and test run assembles
 * its pack in that worker, so every script layer failed to compile and shipped doing nothing - while
 * Dev Mode, which compiles on the main bundle, showed the same scripts working. The unit tests of the
 * compiler were green throughout, because they run the source, where nothing is bundled.
 *
 * So these check the bundles themselves.
 */
describe("the main-process bundles", () => {
    it("all keep esbuild a real require", () => {
        for (const [name] of Object.entries(bundles.MAIN_PROCESS_BUNDLES)) {
            expect(bundles.mainProcessBundleOptions(name, { dev: true }).external, name).toContain("esbuild");
        }
    });

    it("refuse to build when one would inline esbuild", async () => {
        const esbuild = await import("esbuild");
        const options = bundles.mainProcessBundleOptions("compileWorker", { dev: true });
        await expect(esbuild.build({
            ...options,
            entryPoints: undefined,
            stdin: { contents: 'import * as esbuild from "esbuild"; console.log(esbuild);', resolveDir: MAIN_ROOT, loader: "ts" },
            external: (options.external ?? []).filter(name => name !== "esbuild"),
            write: false,
            logLevel: "silent",
        })).rejects.toThrow(/would inline "esbuild"/);
    });

    it("build the compile worker without esbuild inside it", async () => {
        const esbuild = await import("esbuild");
        const result = await esbuild.build({
            ...bundles.mainProcessBundleOptions("compileWorker", { dev: true }),
            write: false,
            metafile: true,
            logLevel: "silent",
        });
        const inlined = Object.keys(result.metafile?.inputs ?? {}).filter(input => /node_modules[\\/]esbuild[\\/]/.test(input));
        expect(inlined).toEqual([]);
    }, 60_000);
});

/*
 * The compile the worker runs, run the way the worker runs it: the script compiler bundled with the
 * compile worker's own options, loaded from the bundle, and asked to compile a real script with the
 * real esbuild. This is the check that was missing - the same module from source had always passed.
 *
 * The bundle is written under the repository's `dist/` rather than the system temp directory for the
 * reason `sevenZipBinary.test.ts` gives: the bundle resolves esbuild at run time by walking up from
 * where it sits, and `dist/` is ignored by git.
 */
describe("a script compiled through the compile worker's bundle", () => {
    let outDir: string;
    let projectPath: string;
    let compileProjectScripts: typeof import("../app/application/managers/devMode/pipeline/scriptCompiler").compileProjectScripts;

    beforeAll(async () => {
        const esbuild = await import("esbuild");
        const distDir = path.join(REPO_ROOT, "dist");
        fs.mkdirSync(distDir, { recursive: true });
        outDir = fs.mkdtempSync(path.join(distDir, "compile-worker-bundle-"));
        const outfile = path.join(outDir, "scriptCompiler.cjs");
        await esbuild.build({
            ...bundles.mainProcessBundleOptions("compileWorker", { dev: true, outDir }),
            entryPoints: undefined,
            stdin: {
                contents: 'export { compileProjectScripts } from "./scriptCompiler";',
                resolveDir: PIPELINE_DIR,
                sourcefile: "compileWorkerScriptEntry.ts",
                loader: "ts",
            },
            outfile,
            logLevel: "silent",
        });
        ({ compileProjectScripts } = require_(outfile) as { compileProjectScripts: typeof compileProjectScripts });

        projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "nl-bundled-scripts-"));
        fs.mkdirSync(path.join(projectPath, "scripts"), { recursive: true });
    }, 60_000);

    afterAll(() => {
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.rmSync(projectPath, { recursive: true, force: true });
    });

    function documentWith(scriptRef: string): BlueprintDocument {
        return {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            ownerRecords: { globalMain: { blueprintId: "bp-script" } },
            blueprints: {
                "bp-script": {
                    id: "bp-script",
                    name: "App",
                    owner: { kind: "globalMain" as const },
                    graphs: {
                        eventIds: ["layer-script"],
                        events: { "layer-script": { id: "layer-script", script: { scriptRef } } },
                        functions: {},
                    },
                },
            },
        } as BlueprintDocument;
    }

    it("compiles, and writes a module the game can import", async () => {
        fs.writeFileSync(
            path.join(projectPath, "scripts", "boot.ts"),
            'import type { GlobalCtx } from "@narraleaf/script";\nexport function onAppBoot(ctx: GlobalCtx): void { void ctx; }\n',
        );
        const directory = path.join(projectPath, "out");

        const compiled = await compileProjectScripts(projectPath, documentWith("scripts/boot.ts"), {
            directory,
            toUrl: filePath => `scripts/${path.basename(filePath)}`,
        });

        const entry = compiled[scriptLayerKey("bp-script", "layer-script")];
        expect(entry?.diagnostics).toBeUndefined();
        expect(entry?.url).toBe("scripts/scripts_boot.js");
        expect(fs.readFileSync(path.join(directory, "scripts_boot.js"), "utf8")).toContain("onAppBoot");
    });
});
