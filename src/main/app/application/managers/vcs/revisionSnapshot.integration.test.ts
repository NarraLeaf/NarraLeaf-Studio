import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported } from "@shared/types/vcs";
import { isVersioned } from "@shared/vcs/workingSet";
import type { BaseApp } from "../../baseApp";
import type { LoreGlobals } from "./lore/call";
import { flushRepository, releaseRepository } from "./lore/verbs";
import { initRepository } from "./repository";
import { revisionSnapshotsRoot } from "./revisionSnapshot";
import { VcsManager } from "./VcsManager";

/**
 * Materialising a revision, against the real library and a real repository.
 *
 * What has to be real here is the one thing a fake cannot fake: that the bytes on disk afterwards are
 * the REVISION'S and not the working tree's. Every cheap way to make a snapshot fast - a hardlink, a
 * copy-if-the-mtime-matches, trusting a directory that already exists - produces a directory that
 * looks right and compiles the wrong game, and nothing but reading a repository back can tell the
 * difference.
 *
 * Only runs where Epic ships a native build (docs/version-control.md §7).
 *
 * Teardown is not optional: Lore's repository lock is EXCLUSIVE and blocking, so a session left open
 * makes the next run of this file wait instead of fail, and on Windows the temp directory cannot be
 * removed at all. flush -> closeStore -> release, in that order (§4.15, §4.19).
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);

const STORY = "editor/story/stories/prologue/storydoc.json";
const BLUEPRINT_SHARD = "assets/assets.metadata.blueprint.json";
const BLUEPRINT_ID = "2d44332f-18b9-4892-b269-c6f02ad31d95";
const BLUEPRINT_CONTENT = "assets/content/2d/44/332f18b94892b269c6f02ad31d95";
/** An image, i.e. exactly what the snapshot deliberately leaves in the repository. */
const IMAGE_CONTENT = "assets/content/ff/ee/0123456789abcdef0123456789ab";
/** Excluded by the working-set policy; must not appear in a snapshot either. */
const THUMBNAIL = "editor/cache/thumbnail/ab/cd/y.png";

let root: string;
let globals: LoreGlobals;
let manager: VcsManager;
let first: string;
let second: string;

function write(relative: string, bytes: string | Buffer): void {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes as never);
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

    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-snapshot-")));
    globals = { repositoryPath: root, offline: true, cache: true };

    write("project.json", JSON.stringify({ name: "prologue" }));
    write(STORY, JSON.stringify({ version: 9, scenes: ["FIRST"] }));
    write(BLUEPRINT_SHARD, JSON.stringify({ [BLUEPRINT_ID]: { id: BLUEPRINT_ID, name: "shared" } }));
    write(BLUEPRINT_CONTENT, JSON.stringify({ blueprint: "FIRST" }));
    write(IMAGE_CONTENT, Buffer.alloc(64 * 1024, 1));
    write(THUMBNAIL, "THUMB");
    await initRepository(globals, { identity: "author@narraleaf" });

    manager = new VcsManager(fakeApp());
    const history = await manager.getHistory(root);
    first = history[0].revision;

    write(STORY, JSON.stringify({ version: 9, scenes: ["SECOND"] }));
    write(BLUEPRINT_CONTENT, JSON.stringify({ blueprint: "SECOND" }));
    second = (await manager.commit(root, { message: "second" })).revision;

    // Uncommitted, so the working tree differs from BOTH revisions. Without this a snapshot that
    // copied the working tree would still pass every assertion below.
    write(STORY, JSON.stringify({ version: 9, scenes: ["WORKING"] }));
}, 300_000);

afterAll(async () => {
    if (!supported) return;
    await manager?.dispose().catch(() => undefined);
    await flushRepository(globals).catch(() => undefined);
    await releaseRepository(globals).catch(() => undefined);
    if (root) {
        for (let attempt = 0; attempt < 20; attempt++) {
            try {
                fs.rmSync(root, { recursive: true, force: true });
                break;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
    }
}, 120_000);

function read(directory: string, relative: string): string {
    return fs.readFileSync(path.join(directory, ...relative.split("/")), "utf-8");
}

describe.skipIf(!supported)("materialising a revision", () => {
    it("writes the revision's bytes, not the working tree's", async () => {
        const snapshot = await manager.materializeRevisionSnapshot(root, first);

        expect(JSON.parse(read(snapshot.directory, STORY)).scenes).toEqual(["FIRST"]);
        // The assertion that makes the previous line mean something: the file on disk right now says
        // something else, and so does the newer revision.
        expect(JSON.parse(fs.readFileSync(path.join(root, STORY), "utf-8")).scenes).toEqual(["WORKING"]);
    }, 120_000);

    it("answers a different revision with different bytes", async () => {
        const snapshot = await manager.materializeRevisionSnapshot(root, second);
        expect(JSON.parse(read(snapshot.directory, STORY)).scenes).toEqual(["SECOND"]);
    }, 120_000);

    it("lands outside the working set, so the author's change list stays their own", async () => {
        const snapshot = await manager.materializeRevisionSnapshot(root, first);
        const relative = path.relative(root, snapshot.directory);

        // The predicate the repository's own ignore file is generated from.
        expect(isVersioned(relative)).toBe(false);

        // And the repository agrees, which is the part a predicate alone cannot promise: after writing a
        // few hundred files into the project directory, nothing under the snapshot appears as a change.
        const status = await manager.getStatus(root);
        expect(status.files.some((file) => file.path.replace(/\\/g, "/").includes(".nlstudio"))).toBe(false);
    }, 120_000);

    it("carries the shared blueprint content the compile path reads, and leaves the media", async () => {
        const snapshot = await manager.materializeRevisionSnapshot(root, first);

        // `loadSharedBlueprints` opens this one. A snapshot without it assembles a bundle whose shared
        // blueprints are silently empty - a game that behaves differently with nothing to say so.
        expect(JSON.parse(read(snapshot.directory, BLUEPRINT_CONTENT)).blueprint).toBe("FIRST");
        // Nothing in the compile path opens an image, and the Dev Mode window resolves asset URLs
        // through its workspace window, which serves the working tree. Copying it would be the whole art
        // budget of the project per launch for no behavioural difference.
        expect(fs.existsSync(path.join(snapshot.directory, ...IMAGE_CONTENT.split("/")))).toBe(false);
        expect(snapshot.skippedFiles).toBe(1);
        expect(snapshot.skippedBytes).toBe(64 * 1024);
    }, 120_000);

    it("keeps one snapshot at a time", async () => {
        await manager.materializeRevisionSnapshot(root, first);
        const latest = await manager.materializeRevisionSnapshot(root, second);
        expect(fs.readdirSync(revisionSnapshotsRoot(root))).toEqual([path.basename(latest.directory)]);
    }, 120_000);

    it("refuses a revision that is not in the repository", async () => {
        // The launch turns this into a refusal the author can read; what matters here is that it is an
        // ERROR at all. A reader that answered an unknown revision with an empty tree would produce an
        // empty snapshot, and an empty snapshot compiles into a game that is merely wrong.
        await expect(manager.materializeRevisionSnapshot(root, "f".repeat(64))).rejects.toThrow();
    }, 120_000);

    it("does not include paths the working set excludes", async () => {
        // `editor/cache/` is not in the repository to begin with, so this is really a check that the
        // ignore file and the snapshot's own filter agree about it.
        const snapshot = await manager.materializeRevisionSnapshot(root, first);
        expect(fs.existsSync(path.join(snapshot.directory, ...THUMBNAIL.split("/")))).toBe(false);
    }, 120_000);
});
