import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { watchSubtree, type SubtreeWatcher } from "./subtreeWatcher";

/**
 * The asset library's watch. What it has to keep from chokidar is the answer - anything under the
 * root moved - and what it exists to drop is the handle per path that answering cost.
 */
const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
    while (cleanup.length > 0) {
        await cleanup.pop()?.();
    }
});

async function makeTree(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "nls-subtree-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, "ab", "cd"), { recursive: true });
    return root;
}

function track(watcher: SubtreeWatcher | null): SubtreeWatcher {
    expect(watcher).not.toBeNull();
    cleanup.push(() => watcher!.close());
    return watcher!;
}

/**
 * Waits for the watch to report a file whose path ends with `name`, rather than for a fixed delay
 * it might beat or lose to.
 */
async function waitFor(reported: string[], name: string, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!reported.some(file => file.endsWith(name)) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

const SENTINEL = "armed.sentinel";

/**
 * Starts watching `root` and returns once the watch is listening in the deepest directory, with
 * everything that took reported and then cleared.
 *
 * A recursive `fs.watch` can return before it listens everywhere: on Linux, Node builds it one
 * directory at a time, so a write made straight after the call can land in a directory nobody is
 * watching yet, and an event from the building can arrive after the test's own steps. A sentinel
 * written where the tests write, and seen reported, is the proof the watch is in place.
 */
async function armed(root: string, reported: string[]): Promise<SubtreeWatcher> {
    const watcher = track(watchSubtree(root, new Map(), file => reported.push(file)));
    const sentinel = path.join(root, "ab", "cd", SENTINEL);
    const deadline = Date.now() + 4000;
    while (!reported.some(file => file.endsWith(SENTINEL)) && Date.now() < deadline) {
        await writeFile(sentinel, String(Date.now()));
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(reported.some(file => file.endsWith(SENTINEL))).toBe(true);
    // One write arrives as several notifications; let the sentinel's settle before clearing.
    await new Promise(resolve => setTimeout(resolve, 150));
    reported.length = 0;
    return watcher;
}

/** What the watch said about the file a test is about, leaving out the sentinel's stragglers. */
function about(reported: string[], name: string): string[] {
    return reported.filter(file => file.endsWith(name));
}

/**
 * Lets the clock move past a file's modification time, so a watch started now finds it written
 * before the watch began. Without it the two can share a millisecond, and a modification time
 * carries the fraction that `Date.now()` rounds away.
 */
async function afterItsWrite(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 20));
}

describe("watchSubtree", () => {
    it("reports a file written deep in the tree", async () => {
        const root = await makeTree();
        const reported: string[] = [];
        await armed(root, reported);

        await writeFile(path.join(root, "ab", "cd", "shard.bin"), "one");
        await waitFor(reported, "shard.bin");

        expect(about(reported, "shard.bin").length).toBeGreaterThan(0);
    });

    it("says nothing about the atomic writer's scratch sibling", async () => {
        const root = await makeTree();
        const reported: string[] = [];
        await armed(root, reported);

        await writeFile(path.join(root, "ab", "cd", "shard.bin.nltmp"), "half");
        // Then a real one, so the assertion is about which of the two arrived rather than about
        // whether the watch works at all.
        await writeFile(path.join(root, "ab", "cd", "shard.bin"), "one");
        await waitFor(reported, "shard.bin");

        expect(about(reported, "shard.bin").length).toBeGreaterThan(0);
        expect(about(reported, ".nltmp")).toEqual([]);
    });

    it("reports nothing more once it is closed", async () => {
        const root = await makeTree();
        const reported: string[] = [];
        const watcher = await armed(root, reported);

        await writeFile(path.join(root, "ab", "cd", "shard.bin"), "one");
        await waitFor(reported, "shard.bin");
        expect(about(reported, "shard.bin").length).toBeGreaterThan(0);

        watcher.close();
        reported.length = 0;
        await writeFile(path.join(root, "ab", "cd", "shard.bin"), "two");
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(reported).toEqual([]);
    });

    it("answers null for a root that is not there, so the caller keeps its chokidar list", () => {
        expect(watchSubtree(path.join(tmpdir(), "nls-subtree-absent-" + Date.now()), new Map(), () => {}))
            .toBeNull();
    });
});

/**
 * The one that matters most, and the one this watcher got wrong when it replaced chokidar: on
 * Windows the recursive watch is asked for `FILE_NOTIFY_CHANGE_LAST_ACCESS` along with everything
 * else, so *reading* a file reports it as changed. A Dev Mode session reads every asset the game
 * shows, so a reload scheduled for a read is a reload scheduled by the game itself - and the next
 * run reads them again.
 */
describe("watchSubtree and a file that is only read", () => {
    it("says nothing about a read", async () => {
        const root = await makeTree();
        const file = path.join(root, "ab", "cd", "shard.bin");
        await writeFile(file, "one");
        const written = await stat(file);
        await afterItsWrite();
        const reported: string[] = [];
        await armed(root, reported);

        // The access itself, stated rather than performed: whether reading a file updates its
        // access time is a per-volume Windows policy, so a test that read the file would pass on
        // the machines where the defect cannot happen and prove nothing on the ones where it can.
        // What arrives at the watch either way is an event for a file whose CONTENTS are untouched.
        await readFile(file);
        await utimes(file, new Date(), written.mtime);
        await new Promise(resolve => setTimeout(resolve, 1500));

        expect(about(reported, "shard.bin")).toEqual([]);
    });

    it("still reports the write that follows the read", async () => {
        const root = await makeTree();
        const file = path.join(root, "ab", "cd", "shard.bin");
        await writeFile(file, "one");
        await afterItsWrite();
        const reported: string[] = [];
        await armed(root, reported);

        await readFile(file);
        await writeFile(file, "a longer second version");
        await waitFor(reported, "shard.bin");

        expect(about(reported, "shard.bin").length).toBeGreaterThan(0);
    });
});
