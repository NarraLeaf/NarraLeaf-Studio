import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every compile that produces a package states which DLC it carries.
 *
 * `DevModeBundleLoadContext.includedDlc` reads absence as "every DLC the project has", because that
 * is what a host with no opinion means - Dev Mode, the workspace preview, a test. For a *package*
 * that reading is the leak: a base build would ship the author's separately-sold content inside the
 * thing they sell first, and nothing would say so. The build states an empty selection instead.
 *
 * Asserted against the source text rather than by running a build, for the reason
 * `persistenceDurability.test` reads sources: what has to be true is a property of every call site,
 * including one a future change adds, and no single run visits them all. A new compile that forgets
 * fails here rather than in a player's install.
 */

const MANAGER = path.resolve(__dirname, "GameBuildManager.ts");
const COMPILE_CALL = "compileGameRuntimeArtifactInWorker(";

describe("packaging compiles state their DLC selection", () => {
    it("passes includedDlc wherever it passes packaging: true", () => {
        const source = fs.readFileSync(MANAGER, "utf-8");
        // Each chunk is one call's arguments, up to wherever the next call starts. Crude on purpose:
        // a brace-accurate parse would be a second TypeScript, and the property only needs the two
        // keys to appear in the same call.
        const chunks = source.split(COMPILE_CALL).slice(1);
        expect(chunks.length).toBeGreaterThan(0);

        const packaging = chunks.filter(chunk => chunk.includes("packaging: true"));
        // If this drops to zero the test has stopped watching anything - the call site was renamed,
        // or the flag spelled another way - and would pass by looking at nothing.
        expect(packaging.length).toBeGreaterThanOrEqual(4);

        const silent = packaging.filter(chunk => !chunk.includes("includedDlc"));
        expect(
            silent.length,
            `${silent.length} packaging compile(s) in GameBuildManager.ts do not state includedDlc. `
            + "Absent means every DLC the project has, so such a build would ship the extra content "
            + "inside the base package. State the selection: [] for a base build, [id] for a DLC.",
        ).toBe(0);
    });
});
