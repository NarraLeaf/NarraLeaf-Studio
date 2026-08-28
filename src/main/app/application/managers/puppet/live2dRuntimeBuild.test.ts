import { execFileSync } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { buildLive2DRuntime, live2dStagingDir } from "./live2dRuntimeBuild";
import { inspectLive2DSdkArchive, readArchiveEntry } from "./live2dSdkArchive";

/**
 * The build, end to end, against a real Cubism SDK archive.
 *
 * Skipped wherever that archive is absent, which is everywhere except a machine someone has downloaded
 * the SDK on — it is 20 MB of Live2D's licensed software and cannot be committed. There is no synthetic
 * substitute worth writing: the assertions below are about whether a genuine Framework *compiles*, which
 * a handful of fake `.ts` files cannot answer.
 *
 * Point `NLS_LIVE2D_SDK_ZIP` at the archive to run it elsewhere.
 */
const REAL_SDK = process.env.NLS_LIVE2D_SDK_ZIP ?? "D:\\Temp\\CubismSdkForWeb-5-r.5.zip";
const hasRealSdk = (() => {
    try {
        return fs.statSync(REAL_SDK).isFile();
    } catch {
        return false;
    }
})();

const GLUE_DIR = path.resolve(__dirname, "../../../../../../resources/puppet-glue/live2d");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nls-live2d-build-"));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe.skipIf(!hasRealSdk)("buildLive2DRuntime", () => {
    it("bundles a loadable runtime out of the author's SDK and Studio's glue", async () => {
        const cacheRoot = path.join(scratch, "nl-cache");
        const targetDir = path.join(scratch, "project", "runtimes", "puppet", "live2d");

        const result = await buildLive2DRuntime({
            archivePath: REAL_SDK,
            targetDir,
            cacheRoot,
            glueDir: GLUE_DIR,
        });

        expect(result.backend).toBe("live2d");
        expect(result.sdkVersion).toBeTruthy();
        expect(result.shaderFiles).toBe(13);
        expect(result.frameworkFiles).toBeGreaterThanOrEqual(50);

        // A real bundle of the Core plus the Framework is around a megabyte. The floor is what catches
        // the failure mode that matters: a build that "succeeded" having tree-shaken everything away.
        expect(result.bytes).toBeGreaterThan(400_000);
        const bundle = await fsp.readFile(result.entryPath, "utf-8");

        // The two things an as-shipped SDK cannot supply, each with a signature in the output. Without
        // the first the Framework reads an undefined global; without the second the renderer compiles
        // empty programs and silently draws nothing.
        expect(bundle).toContain("globalThis.Live2DCubismCore");
        expect(bundle).toContain("SHADER_SOURCES");
        expect(bundle).toContain("vertshadersrc.vert");

        // An ES module with the default export the host loader looks for.
        expect(bundle).toMatch(/export\s*\{/);

        // The Core is redistributed as Live2D provides it — byte for byte, at the head of the file.
        // The Proprietary Software License Agreement grants no right to modify it (6.1) and requires
        // it "on an as is basis" (5.2.4), so a bundler that re-prints it is a licence problem rather
        // than a style one, and this is the assertion that says so.
        const archive = await fsp.readFile(REAL_SDK);
        const core = readArchiveEntry(archive, inspectLive2DSdkArchive(archive).core).toString("utf-8");
        expect(bundle.startsWith(core)).toBe(true);

        // Both copyright headers survive. Neither is a legal comment by esbuild's definition, so
        // neither reaches the output unless it is placed there deliberately; a build without them is
        // one the author is not allowed to distribute.
        expect(bundle).toContain("This file corresponds to the \"Redistributable Code\" in the agreement.");
        expect(bundle).toContain("Live2D Open Software license");

        // Studio's own adapter is in there, not just the SDK: the factory the host loader looks for,
        // and the class it hands back.
        expect(bundle).toContain("createPuppetBackends");
        expect(bundle).toContain("Live2DPuppetInstance");
        expect(bundle).toContain("backend registered");

        // The claim the textual checks above only circle: the file loads, the Core initialises, and the
        // module yields the engine's `PuppetBackend`.
        //
        // Run in a child `node --input-type=module` with `window` defined, which takes two environment
        // problems out of the way — neither of them a defect in the artifact:
        //
        //  - `await import()` *here* fails, because the Core is a UMD bundle branching on
        //    `typeof module` / `typeof exports` and vitest's module runner defines both, so it takes the
        //    CommonJS branch and throws "Cannot set property default of [object Module]".
        //  - plain Node ESM fails too, because the Core's emscripten glue then detects *Node* and
        //    dereferences `__dirname`, which does not exist in an ES module.
        //
        // A browser enters neither branch: `typeof window === "object"` decides it first. So the probe
        // says so, which is what makes this a test of the bundle rather than of Node.
        //
        // Two globals, which is all the Core reads while initialising: `window` to pick that branch, and
        // `document.currentScript` (null is a legal answer) to derive a base URL it never ends up using,
        // because every file this adapter loads comes from a host-supplied URL instead.
        const probe = `
            globalThis.window = globalThis;
            globalThis.document = { currentScript: null };
            const mod = await import(${JSON.stringify(`file://${result.entryPath.replace(/\\/g, "/")}`)});
            const log = [];
            const backend = mod.default({ log: (level, message) => log.push(level + ": " + message) });
            const core = globalThis.Live2DCubismCore;
            console.log(JSON.stringify({
                factory: typeof mod.default,
                name: backend.name,
                mount: typeof backend.mount,
                log,
                coreVersion: core ? core.Version.csmGetVersion() : null,
            }));
        `;
        const probed = JSON.parse(
            execFileSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf-8" }),
        );
        expect(probed.factory).toBe("function");
        expect(probed.name).toBe("live2d");
        expect(probed.mount).toBe("function");
        expect(probed.log.join("\n")).toContain("live2d backend registered");
        // The Core came up under the global the Framework reads, and answers for its own version. Zero
        // or null here is the `globalThis` publish having been dropped from the generated core module.
        expect(probed.coreVersion).toBeGreaterThan(0);

        // The directory explains itself: the author is the one shipping this code.
        const readme = await fsp.readFile(path.join(targetDir, "README.md"), "utf-8");
        expect(readme).toContain("Live2D Inc.");
        expect(readme).toContain(result.sdkVersion!);
        const licenses = await fsp.readdir(path.join(targetDir, "licenses"), { recursive: true });
        expect(licenses.length).toBeGreaterThan(0);
        // The list the Proprietary Software License Agreement points at to state which files may be
        // redistributed at all (1.15) travels with the files it names.
        expect(licenses.some(entry => entry.toString().endsWith("RedistributableFiles.txt"))).toBe(true);
    }, 180_000);

    it("keys its staging on the archive's content, not its path", async () => {
        // Re-picking the same download must not produce a second staging tree, and a different build
        // must not land in the first one's.
        const cacheRoot = path.join(scratch, "nl-cache2");
        const copied = path.join(scratch, "renamed-sdk.zip");
        await fsp.copyFile(REAL_SDK, copied);

        const first = await buildLive2DRuntime({
            archivePath: REAL_SDK,
            targetDir: path.join(scratch, "p1", "live2d"),
            cacheRoot,
            glueDir: GLUE_DIR,
        });
        const second = await buildLive2DRuntime({
            archivePath: copied,
            targetDir: path.join(scratch, "p2", "live2d"),
            cacheRoot,
            glueDir: GLUE_DIR,
        });

        expect(second.bytes).toBe(first.bytes);
        const staged = await fsp.readdir(path.dirname(live2dStagingDir(cacheRoot, "x")));
        expect(staged).toHaveLength(1);
    }, 300_000);

    it("leaves the project untouched when the archive is not an SDK", async () => {
        const targetDir = path.join(scratch, "p3", "live2d");
        await expect(buildLive2DRuntime({
            archivePath: path.join(GLUE_DIR, "index.js"),
            targetDir,
            cacheRoot: path.join(scratch, "nl-cache3"),
            glueDir: GLUE_DIR,
        })).rejects.toThrow(/not a readable \.zip archive/);
        // Nothing half-written: the project directory is not even created on the failure path.
        await expect(fsp.stat(targetDir)).rejects.toThrow();
    });
});
