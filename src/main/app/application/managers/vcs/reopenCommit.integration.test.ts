import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported } from "@shared/types/vcs";
import type { BaseApp } from "../../baseApp";
import type { LoreGlobals } from "./lore/call";
import { flushRepository, releaseRepository } from "./lore/verbs";
import { initRepository } from "./repository";
import { VcsManager } from "./VcsManager";

/**
 * Committing again after the project's session has been closed and reopened.
 *
 * The sequence an author actually performs - close the window (which takes a checkpoint and then
 * releases the session), open the project again, keep working, press Commit - was never covered.
 * Reads after a close were (`commit.integration.test.ts`), writes were not, and the two are not the
 * same question: a read opens a store, a commit opens one and then takes Lore's exclusive repository
 * lock for the whole stage/commit/flush pipeline.
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);

let root: string;
let globals: LoreGlobals;
let manager: VcsManager;

function write(relative: string, bytes: string): void {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
}

function fakeApp(): BaseApp {
    const noop = () => undefined;
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        getGlobalState: () => ({ get: () => undefined }),
    } as unknown as BaseApp;
}

beforeAll(async () => {
    if (!supported) return;
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-reopen-")));
    globals = { repositoryPath: root, offline: true, cache: true };
    write("project.json", JSON.stringify({ name: "reopen" }));
    await initRepository(globals, { identity: "author@narraleaf" });
    manager = new VcsManager(fakeApp());
}, 180_000);

afterAll(async () => {
    if (!supported) return;
    await manager?.dispose().catch(() => undefined);
    await flushRepository(globals).catch(() => undefined);
    await releaseRepository(globals).catch(() => undefined);
    for (let attempt = 0; attempt < 20 && root; attempt++) {
        try {
            fs.rmSync(root, { recursive: true, force: true });
            break;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
}, 120_000);

describe.skipIf(!supported)("committing after the project was closed and reopened", () => {
    it("records a version through a session opened after the previous one was released", async () => {
        write("editor/story/a.json", JSON.stringify({ v: 1 }));
        const first = await manager.commit(root, { message: "Before the close" });
        expect(first.revision).toBeTruthy();

        // What closing a workspace window does, in the order it does it.
        await manager.checkpoint(root, "project-close");
        await manager.closeProject(root);

        // Reopened: the next call has to build a fresh session against a repository this
        // process released moments ago.
        write("editor/story/a.json", JSON.stringify({ v: 2 }));
        const second = await manager.commit(root, { message: "After the reopen" });

        expect(second.revision).toBeTruthy();
        expect(second.number).toBeGreaterThan(first.number);
    }, 120_000);
});
