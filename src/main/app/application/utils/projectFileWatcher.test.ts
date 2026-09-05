import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
    isIgnoredProjectFile,
    watchProjectFiles,
    withoutNestedRoots,
    type ProjectFileWatcher,
} from "./projectFileWatcher";

const openWatchers: ProjectFileWatcher[] = [];
const temporaryRoots: string[] = [];

function temporaryProject(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nls-watch-"));
    // macOS puts the temp directory behind /var -> /private/var, and a recursive watch reports the
    // resolved path. Without this every expectation would compare two spellings of one file.
    const resolved = fs.realpathSync(root);
    temporaryRoots.push(resolved);
    return resolved;
}

function watch(
    paths: string[],
    projectPath: string,
    seen: Map<string, fs.Stats | null>,
): ProjectFileWatcher {
    const watcher = watchProjectFiles(
        paths,
        { ignored: file => isIgnoredProjectFile(projectPath, file) },
        (file, stats) => seen.set(file, stats),
    );
    openWatchers.push(watcher);
    return watcher;
}

/**
 * Wait for a watch to report, repeating the edit while it waits.
 *
 * A recursive watch on macOS is an FSEvents stream that takes a moment to start, and a write in that
 * window is not reported late - it is not reported at all. Production never notices, because a watch
 * is installed when a session starts and the author edits seconds later. A test that wrote once
 * would be a coin toss, so the edit is repeated until the watch answers.
 */
async function until(predicate: () => boolean, again: () => void = () => {}, timeoutMs = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        again();
    }
    expect.fail(`watch reported nothing within ${timeoutMs} ms`);
}

afterEach(() => {
    while (openWatchers.length > 0) {
        openWatchers.pop()?.close();
    }
    while (temporaryRoots.length > 0) {
        const root = temporaryRoots.pop();
        if (root) {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
});

describe("isIgnoredProjectFile", () => {
    const project = path.join(path.sep, "projects", "demo");

    it("ignores the atomic writer's scratch siblings", () => {
        expect(isIgnoredProjectFile(project, path.join(project, "editor", "story", "a.json.nltmp"))).toBe(true);
        expect(isIgnoredProjectFile(project, path.join(project, "editor", "story", "a.json"))).toBe(false);
    });

    it("ignores both reserved directories under scripts, at any depth", () => {
        expect(isIgnoredProjectFile(project, path.join(project, "scripts", "node_modules", "left-pad", "index.js"))).toBe(true);
        expect(isIgnoredProjectFile(project, path.join(project, "scripts", "a", "node_modules", "x.js"))).toBe(true);
        expect(isIgnoredProjectFile(project, path.join(project, "scripts", ".narraleaf", "game.d.ts"))).toBe(true);
        expect(isIgnoredProjectFile(project, path.join(project, "scripts", "intro.ts"))).toBe(false);
    });

    it("leaves directories of the same name outside scripts alone", () => {
        // Only `scripts/` has reserved names. An asset directory that happens to be called
        // node_modules is still the author's, and an edit to it is still a reload.
        expect(isIgnoredProjectFile(project, path.join(project, "assets", "content", "node_modules", "a.png"))).toBe(false);
    });
});

describe("withoutNestedRoots", () => {
    it("keeps only the outermost of overlapping roots", () => {
        const assets = path.join(path.sep, "p", "assets");
        const content = path.join(assets, "content");
        // Both callers list a tree and something inside it. Watched separately under one recursive
        // handle each, every event in the inner tree would arrive twice.
        expect(withoutNestedRoots([content, assets])).toEqual([assets]);
    });

    it("keeps roots that only share a name prefix", () => {
        const assets = path.join(path.sep, "p", "assets");
        const assetsOld = path.join(path.sep, "p", "assets-old");
        expect(withoutNestedRoots([assets, assetsOld]).sort()).toEqual([assets, assetsOld].sort());
    });

    it("drops a repeated root", () => {
        const assets = path.join(path.sep, "p", "assets");
        expect(withoutNestedRoots([assets, assets])).toEqual([assets]);
    });
});

describe("watchProjectFiles", () => {
    it("reports a file written anywhere under a watched directory, with its stats", async () => {
        const project = temporaryProject();
        const deep = path.join(project, "assets", "content", "ab", "cd");
        fs.mkdirSync(deep, { recursive: true });
        const seen = new Map<string, fs.Stats | null>();
        watch([path.join(project, "assets", "content")], project, seen);

        const file = path.join(deep, "sprite.png");
        const write = () => fs.writeFileSync(file, "one");
        write();
        await until(() => seen.has(file), write);
        expect(seen.get(file)?.size).toBe(3);
    }, 15000);

    it("reports a removed file with null stats", async () => {
        const project = temporaryProject();
        const root = path.join(project, "assets", "content");
        fs.mkdirSync(root, { recursive: true });
        const file = path.join(root, "gone.png");
        fs.writeFileSync(file, "one");
        const seen = new Map<string, fs.Stats | null>();
        watch([root], project, seen);

        // Put the file back before removing it again: a repeat of `rm` on a file that has already
        // gone produces no event at all, so the retry has to make a fresh one to observe.
        const remove = () => {
            if (!fs.existsSync(file)) {
                fs.writeFileSync(file, "one");
            }
            fs.rmSync(file, { force: true });
        };
        remove();
        await until(() => seen.get(file) === null, remove);
    }, 15000);

    it("never reports a directory", async () => {
        const project = temporaryProject();
        const root = path.join(project, "assets", "content");
        fs.mkdirSync(root, { recursive: true });
        const seen = new Map<string, fs.Stats | null>();
        watch([root], project, seen);

        const directory = path.join(root, "new-asset");
        fs.mkdirSync(directory);
        const file = path.join(directory, "sprite.png");
        const write = () => fs.writeFileSync(file, "one");
        write();
        await until(() => seen.has(file), write);
        expect(seen.has(directory)).toBe(false);
    }, 15000);

    it("reports a watched file that did not exist when the watch was installed", async () => {
        const project = temporaryProject();
        fs.mkdirSync(path.join(project, "editor", "ui"), { recursive: true });
        const uidoc = path.join(project, "editor", "ui", "uidoc.json");
        const seen = new Map<string, fs.Stats | null>();
        watch([uidoc], project, seen);

        const write = () => fs.writeFileSync(uidoc, "{}");
        write();
        await until(() => seen.has(uidoc), write);
    }, 15000);

    it("reports nothing for an ignored path", async () => {
        const project = temporaryProject();
        const scripts = path.join(project, "scripts");
        fs.mkdirSync(path.join(scripts, "node_modules", "left-pad"), { recursive: true });
        const seen = new Map<string, fs.Stats | null>();
        watch([scripts], project, seen);

        const source = path.join(scripts, "intro.ts");
        const write = () => {
            fs.writeFileSync(path.join(scripts, "node_modules", "left-pad", "index.js"), "one");
            fs.writeFileSync(source, "export {};");
        };
        write();
        // The source is the ordering guarantee: once it has arrived, anything the dependency wrote
        // before it would have arrived too.
        await until(() => seen.has(source), write);
        expect([...seen.keys()].some(file => file.includes("node_modules"))).toBe(false);
    }, 15000);

    it("says nothing about a file written just before the watch was installed", async () => {
        const project = temporaryProject();
        const root = path.join(project, "assets", "content");
        fs.mkdirSync(root, { recursive: true });
        // A session writes files on its way up - a compile's output, a project just created from a
        // template - and macOS hands a recursive watch whatever was still in flight when it opened.
        // MEASURED: without the replay window this file is reported every time.
        const seed = path.join(root, "bg.png");
        fs.writeFileSync(seed, "seed");
        const seen = new Map<string, fs.Stats | null>();
        watch([root], project, seen);

        await new Promise(resolve => setTimeout(resolve, 800));
        expect(seen.has(seed)).toBe(false);

        // And the watch is still live: an edit after it started is reported as usual.
        const write = () => fs.writeFileSync(seed, "edited");
        write();
        await until(() => seen.has(seed), write);
    }, 15000);

    it("closes without waiting on the tree it was watching", async () => {
        const project = temporaryProject();
        const content = path.join(project, "assets", "content");
        // The shape that made this module necessary: one directory per asset. Under a per-directory
        // watch these cost a handle each, and closing them all is what froze the main process.
        for (let index = 0; index < 200; index++) {
            const directory = path.join(content, `asset-${index}`);
            fs.mkdirSync(directory, { recursive: true });
            fs.writeFileSync(path.join(directory, "file.bin"), "x");
        }
        const seen = new Map<string, fs.Stats | null>();
        const watcher = watch([content], project, seen);

        const started = Date.now();
        watcher.close();
        expect(Date.now() - started).toBeLessThan(2000);
    }, 30000);
});
