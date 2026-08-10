import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported } from "@shared/types/vcs";
import {
    branchMergeResolveTheirs,
    branchMergeStart,
    closeStore,
    commit,
    createBranch,
    createRepository,
    flushRepository,
    openStore,
    releaseRepository,
    stage,
    switchBranch,
    type LoreGlobals,
} from "./lore";
import { listFilesAt } from "./revisionReader";

/**
 * Do the merge sidecars get committed when Studio stages before committing?
 *
 * §4.23 measured that a merge commit does NOT carry `~base`/`~mine`/`~theirs` into the
 * revision - but that measurement committed straight after resolving, with no staging
 * step. Studio never commits that way: `commitWorkingTree` runs `stage(globals, [root])`
 * first, which recurses the whole tree, and at that moment the sidecars are sitting in
 * it as ordinary untracked files.
 *
 * So the earlier result does not cover Studio's actual pipeline, and the difference
 * matters: if staging picks them up, resolving a conflict quietly commits three junk
 * files per conflicted document into the author's history, where they are indexed,
 * synced to collaborators, and read back by the document layer as corrupt.
 *
 * This is the question the merge write-back has to answer before it is written, which is why
 * it is measured here rather than discovered there.
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);
const DOCUMENT = "doc.json";

const base = `${JSON.stringify({ id: "scene", title: "Prologue", version: 7 }, null, 2)}\n`;
const mine = `${JSON.stringify({ id: "scene", title: "Prologue (main)", version: 7 }, null, 2)}\n`;
const theirs = `${JSON.stringify({ id: "scene", title: "Prologue (feature)", version: 7 }, null, 2)}\n`;

describe.skipIf(!supported)("merge sidecars and staging", () => {
    it("does not carry the sidecars into a commit that staged the whole tree first", async () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-sidecar-stage-")));
        const globals: LoreGlobals = { repositoryPath: root, offline: true, identity: "check@narraleaf", cache: true };
        const write = (text: string) => fs.writeFileSync(path.join(root, DOCUMENT), text, "utf-8");
        const commitAll = async (message: string) => {
            await stage(globals, [root]);
            const revision = await commit(globals, message);
            await flushRepository(globals);
            return revision.revision;
        };

        const created = await createRepository(globals, {
            repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
            description: "sidecar staging",
        });
        write(base);
        await commitAll("base");
        await createBranch(globals, "feature");
        await switchBranch(globals, { branch: "feature" });
        write(theirs);
        await commitAll("theirs");
        await switchBranch(globals, { branch: "main" });
        write(mine);
        await commitAll("mine");

        const started = await branchMergeStart(globals, { branch: "feature" });
        expect(started.conflicts).toContain(DOCUMENT);
        const sidecars = ["~base", "~mine", "~theirs"]
            .filter((suffix) => fs.existsSync(path.join(root, `${DOCUMENT}${suffix}`)));
        expect(sidecars, "the merge did not leave sidecars, so this test proves nothing").toHaveLength(3);

        await branchMergeResolveTheirs(globals, [path.join(root, DOCUMENT)]);

        // The step §4.23's measurement skipped and Studio always performs.
        const staged = await stage(globals, [root]);
        const stagedSidecars = staged.files.map((file) => file.path).filter((file) => file.includes("~"));

        const revision = await commit(globals, "resolved");
        await flushRepository(globals);

        const store = await openStore(globals, root);
        const committed = (await listFilesAt(globals, store, created.repository, revision.revision))
            .map((entry) => entry.path);
        await flushRepository(globals).catch(() => undefined);
        await closeStore(globals, store).catch(() => undefined);
        await releaseRepository(globals).catch(() => undefined);
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // A leftover temp directory is not a result.
        }

        console.log(`\n### SIDECAR STAGING\n${JSON.stringify({ stagedSidecars, committed }, null, 2)}`);

        // The claim the write-back depends on: whatever staging reported, the author's history holds
        // only their document.
        expect(committed.filter((file) => file.includes("~"))).toEqual([]);
        expect(committed).toContain(DOCUMENT);
    }, 180_000);
});
