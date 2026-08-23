import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import type { WorkspaceFreezeKind } from "./ipcEvents";
import { refusesOperations } from "./workspaceFreeze";

/**
 * The one predicate both processes ask about starting things while frozen.
 *
 * Every kind is listed here by hand rather than derived from the type, so that adding a sixth kind
 * fails a test instead of quietly inheriting whichever answer the union's shape happens to give.
 */
const ALL_KINDS: readonly WorkspaceFreezeKind[] = ["revision", "manual", "merge", "recovery", "live-session"];

describe("refusesOperations", () => {
    it("holds for every freeze that means the author is not reading their working tree", () => {
        for (const kind of ["revision", "manual", "merge", "recovery"] as const) {
            expect(refusesOperations(kind)).toBe(true);
        }
    });

    it("does not hold for a live session, whose content IS the working tree", () => {
        expect(refusesOperations("live-session")).toBe(false);
    });

    it("lets exactly one kind through, so a new kind cannot join the exemption by accident", () => {
        const exempt = ALL_KINDS.filter(kind => !refusesOperations(kind));
        expect(exempt).toEqual(["live-session"]);
    });
});

describe("who asks the predicate", () => {
    it("is asked by main and by the renderer, from this one module", async () => {
        // The failure this pins is the reason the predicate is shared at all: main lets a live
        // session build, preview, export a patch and run a test's game, so a renderer that answered
        // the question on its own - "is anything frozen?" - would grey out controls main would have
        // run. A dead button is worse than either honest state, and nothing on screen would say why.
        const root = path.resolve(__dirname, "..", "..");
        const askers = [
            "main/app/application/managers/build/GameBuildManager.ts",
            "main/app/application/managers/gameTest/GameTestManager.ts",
            "main/app/application/managers/preview/PreviewManager.ts",
            "renderer/apps/workspace/hooks/useWorkspaceFrozen.ts",
            "renderer/apps/workspace/components/ui/freezeActionPolicy.ts",
            "renderer/lib/testing/TestRunService.ts",
        ];
        for (const asker of askers) {
            const source = await fs.readFile(path.join(root, ...asker.split("/")), "utf-8");
            expect(source, asker).toContain("refusesOperations");
            // Nobody re-spells the exemption. A surface that named the kind itself would be the
            // second copy of this answer, and the two would part company on the next kind added.
            expect(source, asker).not.toContain("\"live-session\"");
        }
    });
});
