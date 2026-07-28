import path from "path";
import { describe, expect, it } from "vitest";
import esbuild from "esbuild";

/**
 * The one architectural rule that keeps Studio installable everywhere.
 *
 * Version control is optional: Epic ships no native build for macOS Intel or
 * Windows ARM64. Studio still runs there, minus this feature - but ONLY as long as
 * nothing reaches the native library while the main process is starting up.
 * Loading it eagerly on a host without a build does not disable version control, it
 * prevents the app from opening at all.
 *
 * Comments and code review are not enough to hold that line: the dangerous import
 * is usually indirect, added three modules away by someone who never heard of Lore.
 * So this walks the STATIC import graph of the real main entry point - following
 * only import statements and require calls, never dynamic `import()` - and asserts
 * the binding is not in it.
 *
 * If this fails, find the new static edge into `vcs/lore/` and make it `import type`
 * or a dynamic import. Do not relax the assertion.
 */

const MAIN_ENTRY = path.resolve(__dirname, "../../../../index.ts");
const ROOT = path.resolve(__dirname, "../../../../../..");

/** Externals must match the real build; see project/build/build-main.js. */
const EXTERNAL = ["electron", "esbuild", "@narraleaf/encryption", "koffi"];

async function staticallyReachableInputs(): Promise<Set<string>> {
    const result = await esbuild.build({
        entryPoints: [MAIN_ENTRY],
        bundle: true,
        write: false,
        metafile: true,
        platform: "node",
        format: "cjs",
        target: ["node18"],
        external: EXTERNAL,
        tsconfig: path.join(ROOT, "src", "main", "tsconfig.json"),
        logLevel: "silent",
    });

    const inputs = result.metafile.inputs;
    const entry = Object.keys(inputs).find((file) => file.endsWith("src/main/index.ts"));
    expect(entry, "main entry not found in the bundle metafile").toBeDefined();

    const reachable = new Set<string>();
    const queue = [entry as string];
    while (queue.length > 0) {
        const file = queue.pop() as string;
        if (reachable.has(file)) continue;
        reachable.add(file);
        for (const edge of inputs[file]?.imports ?? []) {
            // The whole point: a dynamic import does not run at startup, so it does
            // not propagate reachability.
            if (edge.kind === "dynamic-import") continue;
            if (edge.external || !inputs[edge.path]) continue;
            queue.push(edge.path);
        }
    }
    return reachable;
}

describe("version control stays pluggable", () => {
    it("never reaches the Lore binding from the main entry point at load time", async () => {
        const reachable = await staticallyReachableInputs();

        // Non-vacuous: the manager and the plug boundary ARE loaded at startup, so
        // the walk demonstrably reaches this directory. Only the binding below them
        // must not be reachable.
        expect([...reachable].some((file) => file.endsWith("managers/vcs/VcsManager.ts"))).toBe(true);
        expect([...reachable].some((file) => file.endsWith("managers/vcs/backend.ts"))).toBe(true);

        const offenders = [...reachable].filter((file) => file.includes("managers/vcs/lore/"));
        expect(offenders, `these modules load the native binding at startup:\n${offenders.join("\n")}`)
            .toEqual([]);
    }, 120_000);

    it("never reaches koffi from the main entry point at load time", async () => {
        // koffi itself is harmless to load, but a static edge to it is the reliable
        // symptom of a static edge into the binding - and the binding is not.
        const result = await esbuild.build({
            entryPoints: [MAIN_ENTRY],
            bundle: true,
            write: false,
            metafile: true,
            platform: "node",
            format: "cjs",
            target: ["node18"],
            external: EXTERNAL,
            tsconfig: path.join(ROOT, "src", "main", "tsconfig.json"),
            logLevel: "silent",
        });

        const reachable = await staticallyReachableInputs();
        const importers = [...reachable].filter((file) =>
            (result.metafile.inputs[file]?.imports ?? []).some(
                (edge) => edge.path === "koffi" && edge.kind !== "dynamic-import",
            ));
        expect(importers, `these startup-reachable modules import koffi:\n${importers.join("\n")}`)
            .toEqual([]);
    }, 120_000);

    it("does reach the binding through a dynamic import, so the feature still exists", async () => {
        // The mirror of the assertions above: proving absence is only meaningful if
        // the code is present by another route. Otherwise deleting `vcs/` entirely
        // would make this suite pass.
        const result = await esbuild.build({
            entryPoints: [path.resolve(__dirname, "backend.ts")],
            bundle: true,
            write: false,
            metafile: true,
            platform: "node",
            format: "cjs",
            target: ["node18"],
            external: EXTERNAL,
            tsconfig: path.join(ROOT, "src", "main", "tsconfig.json"),
            logLevel: "silent",
        });
        const bundled = Object.keys(result.metafile.inputs);
        expect(bundled.some((file) => file.includes("managers/vcs/lore/library.ts"))).toBe(true);
    }, 120_000);
});
