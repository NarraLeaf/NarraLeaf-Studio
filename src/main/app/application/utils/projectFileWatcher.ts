import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import { ATOMIC_WRITE_TEMP_PATTERN } from "@shared/utils/fs";
import { SCRIPTS_DIR, SCRIPTS_GENERATED_DIR, SCRIPTS_MODULES_DIR } from "@shared/project/scriptsDirectory";

/**
 * The file watch behind Dev Mode's reload and the preview runner's relaunch.
 *
 * ## Why this is not just `chokidar.watch`
 *
 * chokidar 4 dropped its fsevents binding, so on macOS it falls back to one `fs.watch` handle per
 * directory. The project trees these watches cover are shallow except for one: the asset store puts
 * every asset in a directory of its own, so a medium project is a couple of thousand directories and
 * therefore a couple of thousand handles.
 *
 * Opening them is cheap and closing them is not. MEASURED on a 1 653-asset project (1 886 watched
 * directories, macOS 15, Node 20):
 *
 *   - `chokidar.watch(...)` ready in 403 ms, `close()` in **25 752 ms**
 *   - the same directories as raw `fs.watch` handles: open 80 ms, close 10 672 ms
 *   - the same tree as ONE `fs.watch(root, { recursive: true })`: open 1 ms, close 0 ms
 *
 * That close is on the teardown path of both Dev Mode and the preview, so stopping either one froze
 * the whole main process - every Studio window with it - for as long as it took. The cost is in the
 * shape, not in watching: one recursive handle sees the same tree for nothing.
 *
 * So where the platform has a native recursive watch - macOS and Windows - this uses one handle per
 * root and none per directory. Everywhere else it is chokidar, unchanged. Linux is deliberately on
 * the chokidar path: `fs.watch`'s recursive mode there is newer than the rest and not what these
 * watches have been running on.
 *
 * ## What a caller gets
 *
 * One callback for every kind of change, rather than chokidar's add/change/unlink. Both callers
 * already funnel all three into the same debounced reload and tell them apart only by the stats,
 * which this passes through: `null` means the path is gone, and anything else is the file as it is
 * now. A file appearing for the first time has no recorded identity, so the identity check in
 * `watchedFileIdentity.ts` reports it as changed exactly as an `add` event used to.
 *
 * Directories are never reported. A recursive watch names them like any other path, and a caller
 * that took one for a file would schedule a reload for the directory an asset was written into as
 * well as for the asset.
 */

/** What a watch reports: the path, and how it looks now - or `null` when it is gone. */
export type ProjectFileListener = (file: string, stats: fs.Stats | null) => void;

export type ProjectFileWatchOptions = {
    /** Paths never reported, tested against the absolute path. */
    ignored?: (file: string) => boolean;
};

export interface ProjectFileWatcher {
    /** Stop watching. Cheap on the recursive path, and the whole point of it. */
    close(): void;
}

/**
 * Paths inside a project that a reload watch must never report.
 *
 * Two kinds, and both would otherwise cost a reload for something that is not an edit:
 *
 *  - The atomic writer's scratch siblings. One lives in the tree for a few milliseconds before being
 *    renamed into place, so reporting it schedules a reload against a file that is already gone -
 *    on top of the reload the rename itself triggers.
 *  - The two reserved directories under `scripts/`. An `npm install` there is tens of thousands of
 *    files, and Studio's own generated declarations are written by the compile the reload runs. What
 *    a script imports from either is already inside the bundle esbuild produced.
 */
export function isIgnoredProjectFile(projectPath: string, file: string): boolean {
    if (ATOMIC_WRITE_TEMP_PATTERN.test(file)) {
        return true;
    }
    const segments = path.relative(projectPath, file).split(path.sep);
    if (segments[0] !== SCRIPTS_DIR) {
        return false;
    }
    return segments.includes(SCRIPTS_MODULES_DIR) || segments[1] === SCRIPTS_GENERATED_DIR;
}

/** Platforms whose `fs.watch` implements `recursive` natively. */
function hasNativeRecursiveWatch(): boolean {
    return process.platform === "darwin" || process.platform === "win32";
}

/**
 * Drop any root that another root already covers.
 *
 * Exported for its own test: it is the one part of the plan that cannot be seen from the outside.
 *
 * The callers list overlapping paths on purpose - `assets` and `assets/content`, a file and the tree
 * it sits in - which under chokidar was free and under a recursive watch would report every event
 * twice.
 */
export function withoutNestedRoots(roots: readonly string[]): string[] {
    const sorted = [...new Set(roots)].sort((a, b) => a.length - b.length);
    const kept: string[] = [];
    for (const root of sorted) {
        const covered = kept.some(other => root === other || root.startsWith(other + path.sep));
        if (!covered) {
            kept.push(root);
        }
    }
    return kept;
}

/**
 * Split what the caller asked for into directories to watch recursively and single files to watch
 * through their parent directory.
 *
 * A file is watched through its parent rather than directly because the caller's list includes
 * documents that need not exist yet - a project with no brand palette, a story tree not created
 * until the author adds a scene. `fs.watch` on a missing path throws; the parent is there either
 * way, and reports the file the moment it appears.
 */
function planRoots(paths: readonly string[]): { directories: string[]; files: Map<string, Set<string>> } {
    const directories: string[] = [];
    const files = new Map<string, Set<string>>();
    for (const target of paths) {
        let isDirectory = false;
        try {
            isDirectory = fs.statSync(target).isDirectory();
        } catch {
            isDirectory = false;
        }
        if (isDirectory) {
            directories.push(target);
            continue;
        }
        const parent = path.dirname(target);
        const names = files.get(parent) ?? new Set<string>();
        names.add(path.basename(target));
        files.set(parent, names);
    }
    return { directories: withoutNestedRoots(directories), files };
}

/**
 * How long after a watch is installed an event may still be about a write that preceded it.
 *
 * MEASURED: a file created immediately before `fs.watch(root, { recursive: true })` is reported by
 * that watch every time; the same file created 200 ms earlier is not. FSEvents coalesces on a
 * latency of its own and hands the stream whatever was still in flight when it opened. chokidar hid
 * this behind the tree scan its `ignoreInitial` was measured against; without a scan the window has
 * to be named instead.
 *
 * Half a second is that window with room to spare, and it is bounded on purpose: a file copied into
 * the project with its modification time preserved - an unpacked archive, `cp -p` - is a real change
 * that looks old, and only the events inside this window are allowed to be judged by their age.
 */
const REPLAY_WINDOW_MS = 500;

/**
 * Report one path, once it is known not to be a directory and not to be ignored.
 *
 * The stat is what tells a write from a deletion, and it is also the `alwaysStat` the identity check
 * needs: without a modification time and a size, every event would have to be taken at face value
 * and a game that merely *read* its own assets would keep reloading itself.
 */
function report(
    file: string,
    options: ProjectFileWatchOptions,
    listener: ProjectFileListener,
    watchStartedAt: number,
): void {
    if (options.ignored?.(file)) {
        return;
    }
    let stats: fs.Stats;
    try {
        stats = fs.statSync(file);
    } catch {
        listener(file, null);
        return;
    }
    if (stats.isDirectory()) {
        return;
    }
    // See REPLAY_WINDOW_MS: what the session itself wrote on its way up - a compile's output, the
    // files a project was just created from - would otherwise arrive as the first change of the
    // session and cost a reload before the author had touched anything.
    // `+ 1` because the two clocks do not have the same resolution: `Date.now()` is whole
    // milliseconds and a modification time is finer, so a write in the millisecond the watch opened
    // reads as *later* than the watch that did not see it.
    if (Date.now() - watchStartedAt < REPLAY_WINDOW_MS && stats.mtimeMs < watchStartedAt + 1) {
        return;
    }
    listener(file, stats);
}

function watchNatively(
    paths: readonly string[],
    options: ProjectFileWatchOptions,
    listener: ProjectFileListener,
    onError: (error: unknown) => void,
): ProjectFileWatcher {
    const { directories, files } = planRoots(paths);
    const handles: fs.FSWatcher[] = [];
    const startedAt = Date.now();

    const open = (target: string, recursive: boolean, handle: (name: string) => void): void => {
        try {
            const watcher = fs.watch(target, { recursive }, (_event, name) => {
                if (typeof name === "string" && name.length > 0) {
                    handle(name);
                }
            });
            // A watched directory can be renamed or deleted under us. That is a project change like
            // any other and not a reason to take the process down, so the handle is dropped and the
            // rest of the watch carries on.
            watcher.on("error", error => onError(error));
            handles.push(watcher);
        } catch (error) {
            onError(error);
        }
    };

    for (const directory of directories) {
        open(directory, true, name => report(path.join(directory, name), options, listener, startedAt));
    }
    for (const [parent, names] of files) {
        open(parent, false, name => {
            if (names.has(name)) {
                report(path.join(parent, name), options, listener, startedAt);
            }
        });
    }

    return {
        close(): void {
            for (const handle of handles) {
                try {
                    handle.close();
                } catch {
                    // Already closed, or its directory is gone. Nothing left to release either way.
                }
            }
            handles.length = 0;
        },
    };
}

function watchWithChokidar(
    paths: readonly string[],
    options: ProjectFileWatchOptions,
    listener: ProjectFileListener,
): ProjectFileWatcher {
    const watcher = chokidar.watch([...paths], {
        ignoreInitial: true,
        ignored: options.ignored ? (file: string) => options.ignored!(file) : undefined,
        alwaysStat: true,
    });
    watcher.on("add", (file, stats) => listener(file, stats ?? null));
    watcher.on("change", (file, stats) => listener(file, stats ?? null));
    watcher.on("unlink", file => listener(file, null));
    return {
        close(): void {
            void watcher.close();
        },
    };
}

/**
 * Watch a project's documents and assets for the reload that follows an edit.
 *
 * @param paths Files and directories to watch. Directories are watched to any depth; a path that
 *              does not exist yet is reported when it appears.
 * @param options `ignored` is consulted for every event, with the absolute path.
 * @param listener Called with the path and its stats, or `null` stats when the path has gone.
 * @param onError Called for a watch that could not be opened or that failed later. The watch as a
 *                whole survives it.
 */
export function watchProjectFiles(
    paths: readonly string[],
    options: ProjectFileWatchOptions,
    listener: ProjectFileListener,
    onError: (error: unknown) => void = () => {},
): ProjectFileWatcher {
    return hasNativeRecursiveWatch()
        ? watchNatively(paths, options, listener, onError)
        : watchWithChokidar(paths, options, listener);
}
