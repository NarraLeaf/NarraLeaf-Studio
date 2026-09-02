import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What a shipped artifact says about where it came from.
 *
 * Asserted against the source text rather than by running a build, for the reason
 * `dlcSelectionStated.test` reads sources: what has to be true is a property of every call site,
 * including one a future change adds, and no single run visits them all. A compile that forgets
 * produces a package nobody can trace back, and nothing about the package says so.
 */

const MANAGER = path.resolve(__dirname, "GameBuildManager.ts");
const COMPILE_CALL = "compileGameRuntimeArtifactInWorker(";

describe("packaging compiles state where they came from", () => {
    it("passes projectRevision wherever it passes packaging: true", () => {
        const source = fs.readFileSync(MANAGER, "utf-8");
        // Each chunk is one call's input object: from the call up to `}, {`, where the hooks
        // argument begins. Crude on purpose - a brace-accurate parse would be a second TypeScript -
        // but the cut matters rather than being tidiness. Splitting on the next call alone leaves
        // the LAST call's chunk running to the end of the file, where these key names occur in other
        // methods, and a missing key there would pass by reading somebody else's code.
        const chunks = source.split(COMPILE_CALL).slice(1).map(chunk => {
            const end = chunk.indexOf("}, {");
            expect(end, "a compile call whose input object does not end at `}, {`").toBeGreaterThan(0);
            return chunk.slice(0, end);
        });
        const packaging = chunks.filter(chunk => chunk.includes("packaging: true"));
        // If this drops to zero the test has stopped watching anything - the call site was renamed,
        // or the flag spelled another way - and would pass by looking at nothing.
        expect(packaging.length).toBeGreaterThanOrEqual(4);

        // The patch baseline is compiled to be read back entry by entry and then overwritten by the
        // next export. Nothing about it is delivered, so there is nobody to trace it for.
        const delivered = packaging.filter(chunk => !chunk.includes("forComparison: true"));
        expect(delivered.length).toBeGreaterThanOrEqual(3);

        const silent = delivered.filter(chunk => !chunk.includes("projectRevision"));
        expect(
            silent.length,
            `${silent.length} packaging compile(s) in GameBuildManager.ts do not pass projectRevision. `
            + "A player reporting a bug against one of those packages leaves the author with no way "
            + "back to the project state that produced it. Pass the revision the run checkpointed.",
        ).toBe(0);
    });

    it("compares the engine when a patch has a baseline to compare against", () => {
        const source = fs.readFileSync(MANAGER, "utf-8");
        // The two packs go to the comparison, and the comparison decides the console level. Pinned
        // together because a level written out here instead would be a second answer to a question
        // `describePatchEngineCheck` exists to settle - and the two would part on the first change.
        expect(source).toMatch(/describePatchEngineCheck\(\s*checkPatchEngine\([^)]*\)\s*\)/);
    });
});
