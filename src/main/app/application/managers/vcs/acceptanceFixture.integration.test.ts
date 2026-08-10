import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { isVcsPlatformSupported } from "@shared/types/vcs";
import {
    branchMergeStart,
    commit,
    createBranch,
    switchBranch,
    flushRepository,
    releaseRepository,
    repositoryStatus,
    stage,
    type LoreGlobals,
} from "./lore";

/**
 * Not a test: a fixture builder for real-app acceptance of conflict resolution.
 *
 * Studio can only produce a conflict by syncing, and a sync needs a server, a collaborator
 * who pushed, and a local commit touching the same file. That is several minutes of setup
 * no test should own, so it lives here behind an env var and leaves the project on disk in
 * exactly the state the resolve surface is meant to handle: an open merge with one
 * conflicted document.
 *
 * ```bash
 * NLS_ACCEPTANCE_PROJECT=D:/Temp/nls-d6acc LORE_TEST_REMOTE="lore://127.0.0.1:41337" \
 *   node <vitest> run src/main/app/application/managers/vcs/acceptanceFixture.integration.test.ts
 * ```
 */

const PROJECT = (process.env.NLS_ACCEPTANCE_PROJECT ?? "").trim();
const enabled = (isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH)) && PROJECT !== "";

/** A document Studio itself will not rewrite while the window is open, so the conflict stays put. */
const TARGET = process.env.NLS_ACCEPTANCE_TARGET?.trim() || "editor/story/index.json";

function offline(root: string): LoreGlobals {
    return { repositoryPath: root, offline: true, identity: "author@narraleaf", cache: true };
}

function online(root: string): LoreGlobals {
    return { ...offline(root), offline: false };
}

describe.skipIf(!enabled)("acceptance fixture", () => {
    it("leaves the project mid-merge with one conflicted document", async () => {
        const report: Record<string, unknown> = { project: PROJECT };

        // A LOCAL two-branch merge rather than a sync. Both origins leave the same thing on
        // disk - the conflicted file plus its three sidecars (docs section 4.23, measured
        // byte-identical from both) - and the resolve pipeline reads the sidecars rather than
        // calling the side verbs, precisely because those two disagree between the origins
        // (section 4.31). So this reaches the state the surface has to handle without needing a
        // server, a clone and a push in the middle of an acceptance run.
        const target = path.join(PROJECT, TARGET);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        // A localization document when asked for one, because that is the format whose
        // per-change resolution is worth looking at: two translations of one unit, side by
        // side, is the entire act of choosing.
        const localization = TARGET.includes("/localization/");
        if (localization && !fs.existsSync(target)) {
            fs.writeFileSync(target, `${JSON.stringify({
                schemaVersion: 1,
                locale: path.basename(TARGET, ".json"),
                units: {
                    "unit-shared": { target: "Untouched by either side", sourceHash: "h0", status: "translated" },
                    "unit-contested": { target: "The original translation", sourceHash: "h1", status: "translated" },
                },
            }, null, 2)}
`, "utf-8");
        }
        // Scan BEFORE staging. `stage` leaves a staged state even when it stages nothing, and
        // `branch_switch` then refuses with "Unable to switch branch when there is a staged
        // state" - so an unconditional stage makes the rest of this unreachable.
        const dirty = await repositoryStatus(offline(PROJECT), { scan: true });
        report.dirtyAtStart = dirty.files.filter(file => file.dirty || file.action !== 0).length;
        if (report.dirtyAtStart) {
            await stage(offline(PROJECT), [PROJECT]);
            await commit(offline(PROJECT), "acceptance: settle the working tree");
            await flushRepository(offline(PROJECT));
        }

        const edit = (marker: string) => {
            const document = JSON.parse(fs.readFileSync(target, "utf-8")) as Record<string, unknown>;
            if (localization) {
                const units = document.units as Record<string, { target: string }>;
                units["unit-contested"].target = marker;
                // A unit only one side adds must merge silently rather than ask.
                units[marker.includes("author") ? "unit-from-author" : "unit-from-collaborator"] =
                    { target: marker, sourceHash: "h2", status: "translated" } as never;
            } else {
                document.acceptanceMarker = marker;
            }
            fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}
`, "utf-8");
        };

        // Unique per run: a repository copied from a previous attempt still carries the branch,
        // and `branch_create` refuses rather than reusing it.
        const branch = `collaborator-${Date.now().toString(36)}`;
        report.branch = branch;
        await createBranch(offline(PROJECT), branch);
        await switchBranch(offline(PROJECT), { branch });
        edit("the collaborator wrote this");
        await stage(offline(PROJECT), [PROJECT]);
        await commit(offline(PROJECT), "collaborator: touch the story index");
        await flushRepository(offline(PROJECT));

        await switchBranch(offline(PROJECT), { branch: "main" });
        edit("the author wrote this");
        await stage(offline(PROJECT), [PROJECT]);
        await commit(offline(PROJECT), "author: touch the story index");
        await flushRepository(offline(PROJECT));

        const merge = await branchMergeStart(offline(PROJECT), { branch });
        report.conflicts = merge.conflicts;
        report.sidecars = ["~base", "~mine", "~theirs"].filter(s => fs.existsSync(`${target}${s}`));
        await flushRepository(offline(PROJECT));
        await releaseRepository(offline(PROJECT));

        console.log(`
### ACCEPTANCE FIXTURE
${JSON.stringify(report, null, 2)}`);
        expect(merge.conflicts.length).toBeGreaterThan(0);
    }, 300_000);
});
