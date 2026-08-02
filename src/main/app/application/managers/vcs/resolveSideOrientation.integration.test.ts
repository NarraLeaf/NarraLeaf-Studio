import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported } from "@shared/types/vcs";
import {
    branchMergeResolveMine,
    commit,
    createRepository,
    flushRepository,
    releaseRepository,
    stage,
    syncRevision,
    type LoreGlobals,
} from "./lore";
import { cloneInto, publishToRemote, pushToRemote, writeRemote } from "./remote";

/**
 * Which side does `branch_merge_resolve_mine` actually write, after a SYNC?
 *
 * The whole of tier-one resolution rests on this. `~mine` is the author's own content -
 * that much is measured (docs §4.23) - and the natural reading is that `_mine` writes the
 * same side. If it does not, then a button labelled "keep mine" hands the author their
 * collaborator's file instead, deletes their own work, and every local test still passes,
 * because locally the two agree.
 *
 * So this asserts the orientation directly and independently of the resolve pipeline: it
 * compares the bytes `_mine` leaves in the working tree against the two texts, by content,
 * with no sidecar and no Studio code in between.
 *
 * A sync is the only way Studio can produce a conflict today, so the sync orientation is
 * the one that decides what the button does.
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);
const SERVER = (process.env.LORE_TEST_REMOTE ?? "").trim();
const DOCUMENT = "doc.json";

const base = `${JSON.stringify({ id: "s", title: "Prologue" }, null, 2)}\n`;
const authorText = `${JSON.stringify({ id: "s", title: "AUTHOR wrote this" }, null, 2)}\n`;
const serverText = `${JSON.stringify({ id: "s", title: "SERVER wrote this" }, null, 2)}\n`;

function offline(root: string): LoreGlobals {
    return { repositoryPath: root, offline: true, identity: "orientation@narraleaf", cache: true };
}

function online(root: string): LoreGlobals {
    return { ...offline(root), offline: false };
}

async function commitAll(globals: LoreGlobals, root: string, message: string): Promise<void> {
    await stage(globals, [root]);
    await commit(globals, message);
    await flushRepository(globals);
}

describe.skipIf(!supported || SERVER === "")("which side resolve_mine writes after a sync", () => {
    it("compares its bytes against the author's text and the server's", async () => {
        const authorRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-orient-author-")));
        const cloneBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-orient-clone-")));
        const cloneRoot = path.join(cloneBase, "project");
        const url = `${SERVER}/orient-${Date.now().toString(36)}`;
        const document = path.join(authorRoot, DOCUMENT);

        const created = await createRepository(offline(authorRoot), {
            repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
            description: "resolve orientation",
        });
        fs.writeFileSync(document, base, "utf-8");
        await commitAll(offline(authorRoot), authorRoot, "base");
        await writeRemote(authorRoot, url);
        await publishToRemote(online(authorRoot), { url, repositoryId: created.repository });
        await pushToRemote(online(authorRoot));
        await releaseRepository(online(authorRoot));

        // The collaborator edits the same key and pushes.
        await cloneInto(online(cloneRoot), { repositoryUrl: url });
        fs.writeFileSync(path.join(cloneRoot, DOCUMENT), serverText, "utf-8");
        await commitAll(online(cloneRoot), cloneRoot, "server side");
        await pushToRemote(online(cloneRoot));
        await releaseRepository(online(cloneRoot));

        // The author edits it too, without syncing, and then syncs: a real conflict.
        fs.writeFileSync(document, authorText, "utf-8");
        await commitAll(online(authorRoot), authorRoot, "author side");
        await syncRevision(online(authorRoot));

        const sidecar = (suffix: string) => fs.existsSync(`${document}${suffix}`)
            ? fs.readFileSync(`${document}${suffix}`, "utf-8")
            : null;
        const describeText = (text: string | null) => text === null ? "absent"
            : text === authorText ? "AUTHOR"
                : text === serverText ? "SERVER"
                    : text === base ? "BASE" : "other";

        const sidecarMine = describeText(sidecar("~mine"));
        const sidecarTheirs = describeText(sidecar("~theirs"));

        await branchMergeResolveMine(online(authorRoot), [document]);
        const afterResolveMine = describeText(fs.readFileSync(document, "utf-8"));

        console.log(`\n### RESOLVE ORIENTATION AFTER SYNC\n${JSON.stringify({
            sidecarMine, sidecarTheirs, afterResolveMine,
        }, null, 2)}`);

        await flushRepository(online(authorRoot)).catch(() => undefined);
        await releaseRepository(online(authorRoot)).catch(() => undefined);
        for (const root of [authorRoot, cloneBase]) {
            try {
                fs.rmSync(root, { recursive: true, force: true });
            } catch {
                // A leftover temp directory is not a result.
            }
        }

        // The sidecar is the author's own content - that is what the write-back relies on.
        expect(sidecarMine).toBe("AUTHOR");
        expect(sidecarTheirs).toBe("SERVER");
        // And the verb of the same name does NOT agree with it after a sync. If this ever
        // starts failing, tier one can go back to calling the verb directly - but until
        // then, "keep mine" must be built from the sidecar or it discards the author's work.
        expect(afterResolveMine).toBe("SERVER");
    }, 240_000);
});
