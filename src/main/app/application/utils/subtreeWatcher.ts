import { watch, type FSWatcher } from "fs";
import { stat } from "fs/promises";
import * as path from "path";
import { rememberWatchedFile, watchedFileChanged } from "./watchedFileIdentity";
import { ATOMIC_WRITE_TEMP_PATTERN } from "@shared/utils/atomicWriteTemp";

/**
 * One OS watch handle for a whole subtree, for the trees that are too big to watch path by path.
 *
 * chokidar opens one `fs.watch` handle per directory AND per file it is given. That is the right
 * bargain for the dozen documents a Dev Mode session names by hand - the add/change/unlink
 * distinction and the stats it hands back are what keep a temp file from scheduling a reload - and
 * the wrong one for a project's asset library, which is asked a much smaller question: did anything
 * under this root move.
 *
 * What makes it the wrong bargain is not the handles but when they are opened. `uv_fs_event_start`
 * is synchronous native work on the thread that calls it, so opening one is not something the event
 * loop can do in the background. MEASURED on a 1653-asset project, whose `assets/content` is 1884
 * directories and 1653 files: **3.1s of blocked main-process event loop**, paid at every Dev Mode
 * start and every preview launch. That is most of what "starting Dev Mode is slow" was - not
 * because the watching itself is slow to finish, but because everything else the boot needs from
 * the main process queues behind it, the read grants for those same assets first among them.
 *
 * A recursive watch is one handle for the same subtree: native on Windows and macOS, and on Linux
 * whatever Node's own implementation does - which is at worst the per-directory watching this
 * replaces. Where it cannot be had at all, or where the root does not exist yet, this answers null
 * and the caller keeps the root in its chokidar list, which is what every caller did before.
 *
 * ## Reading a file is not changing it
 *
 * The raw watch is coarser than chokidar's add/change/unlink, and the difference is not academic.
 * libuv asks Windows for `FILE_NOTIFY_CHANGE_LAST_ACCESS` along with everything else, so on a
 * volume that keeps access times, **opening a file reports it as changed** - MEASURED on a real
 * project: twenty reads of untouched asset shards, eleven change notifications. The tree this
 * watches is the one a running game reads from, so taking those at face value made every game that
 * showed a picture schedule the reload that restarted it, which read the pictures again.
 *
 * So an event is only a change when the file behind it was written **since this watch began**.
 * Nothing else can be, and a read cannot move a modification time. The identity check behind that
 * one is what stops a file the author really did edit from re-reporting on every later read of it.
 *
 * That comparison is against this machine's clock, which is the same assumption the identity check
 * beside it already makes. A project tree whose modification times run behind the clock reading
 * them - one on a share with a skewed clock - would have an edit read as untouched.
 */
export type SubtreeWatcher = {
    close(): void;
};

export function watchSubtree(
    root: string,
    identities: Map<string, string>,
    onChange: (file: string) => void,
): SubtreeWatcher | null {
    let watcher: FSWatcher;
    try {
        watcher = watch(root, { recursive: true });
    } catch {
        return null;
    }

    let closed = false;
    // Everything under the root is as the watch found it. A file whose modification time is not
    // newer than this has not been written since, whatever the notification says.
    const startedAt = Date.now();
    // A tree that goes away under the watch - the project moved, the drive was unplugged - is not
    // something to reload into, and an unhandled `error` on an FSWatcher takes the process with it.
    watcher.on("error", () => {});
    watcher.on("change", (_event, name) => {
        if (closed || !name) {
            return;
        }
        const file = path.join(root, name.toString());
        // The one filter every watcher uses: the atomic writer's scratch sibling is in the tree for
        // a few milliseconds before the rename, and reporting it schedules a reload for a file that
        // is already gone - on top of the one the rename itself causes.
        if (ATOMIC_WRITE_TEMP_PATTERN.test(file)) {
            return;
        }
        void (async () => {
            const stats = await stat(file).catch(() => null);
            if (closed) {
                return;
            }
            if (!stats) {
                // Gone: an unlink, or a rename's old name. Forget it, so the same path appearing
                // again reads as new rather than as unchanged.
                identities.delete(file);
                onChange(file);
                return;
            }
            if (stats.mtimeMs <= startedAt) {
                // Untouched since the watch began, so this notification is about something other
                // than its contents - an access, an attribute. Remembered rather than dropped, so
                // that a later write to it is compared against what is on disk now.
                rememberWatchedFile(identities, file, stats);
                return;
            }
            // The same filter the named documents get: one write arrives as several notifications,
            // and every later read of a file that was written under this watch arrives as one more.
            // Only files carry an identity - a directory event is reported as it arrives.
            if (stats.isFile() && !watchedFileChanged(identities, file, stats)) {
                return;
            }
            onChange(file);
        })();
    });

    return {
        close: () => {
            closed = true;
            watcher.close();
        },
    };
}

