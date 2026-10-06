import fs from "fs/promises";
import path from "path";

/** How often a packaging step's output is looked at. */
export const OUTPUT_GROWTH_INTERVAL_MS = 30 * 1000;

/**
 * Call `onChange` whenever the bytes under `dir` differ from the last look, looking every
 * `intervalMs` until the returned function is called.
 *
 * It exists for the stretches of a build that make progress without saying so. electron-builder
 * hands an installer's payload or a zip to 7-Zip, a disk image to hdiutil, and each of those runs for
 * as long as the content takes - minutes on a large game - without a line or a count. The file they
 * are writing is the one thing that moves, so it is what is watched.
 *
 * The first look only takes the measure; there is nothing to compare it with yet.
 */
export function watchOutputGrowth(
    dir: string,
    onChange: () => void,
    intervalMs: number = OUTPUT_GROWTH_INTERVAL_MS,
): () => void {
    let last: number | null = null;
    let looking = false;
    let stopped = false;
    const timer = setInterval(() => {
        // A look over a large tree on a slow disk can outlast the interval; the next waits for it.
        if (looking) {
            return;
        }
        looking = true;
        void measureTree(dir)
            .then(bytes => {
                if (!stopped && last !== null && bytes !== last) {
                    onChange();
                }
                last = bytes;
            })
            .finally(() => {
                looking = false;
            });
    }, intervalMs);
    // Never the reason a process stays up.
    timer.unref?.();
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}

/**
 * The bytes of every file under `dir`, 0 for a directory that is not there.
 *
 * Links are not followed: a macOS app bundle is full of them, each pointing back inside the bundle,
 * and following them counts the same framework several times or never finishes.
 */
export async function measureTree(dir: string): Promise<number> {
    let entries: import("fs").Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return 0;
    }
    let total = 0;
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            total += await measureTree(full);
        } else if (entry.isFile()) {
            // A file the step deletes between the listing and this is simply not counted.
            total += await fs.stat(full).then(stats => stats.size, () => 0);
        }
    }
    return total;
}
