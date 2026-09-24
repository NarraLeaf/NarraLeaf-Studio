/**
 * How much memory a running game costs the machine it runs on, process by process.
 *
 * Read in the main process from Electron's process metrics (`app.getAppMetrics()`), which is the
 * operating system's own account: the same working set a task manager shows. Nothing a page can
 * read gives this. `performance.memory` describes one JavaScript heap, and in Electron it is also
 * rounded to coarse buckets - the two arms of a measured comparison both read exactly 92.9 MB -
 * while the memory a visual novel actually spends is mostly outside any heap:
 * decoded pictures, textures in the GPU process, audio buffers, the main process serving and
 * decrypting assets. The whole game is several processes, and only the process that owns them can
 * see all of them.
 *
 * `process.memoryUsage()` in the main process was the other candidate and answers a narrower
 * question - the main process's own heap and buffers - which is the one process a game's pictures
 * are not in.
 *
 * Comments in English per project convention.
 */

/** What a process is for, in the words a reader of a memory report needs. */
export type GameProcessKind = "main" | "renderer" | "gpu" | "utility" | "other";

export type GameProcessMemoryEntry = {
    kind: GameProcessKind;
    /**
     * What the platform calls it, when it says: a utility process names its service ("Network
     * Service", "Audio Service", a sidecar's own name). Absent for the rest.
     */
    name?: string;
    /** Whether this is the process the asking page runs in. */
    current: boolean;
    /** Memory currently resident in physical RAM, in bytes. */
    workingSetBytes: number;
    /** The most this process has ever had resident, in bytes. */
    peakWorkingSetBytes: number;
    /** Memory no other process shares, in bytes. Windows reports it; other platforms do not. */
    privateBytes?: number;
};

export type GameProcessMemoryReading = {
    /**
     * What the processes below add up to.
     *
     * - `game` - every process the game is made of. A packaged game and a preview.
     * - `window` - only the process that draws this window. Dev Mode: the window is Studio's, and
     *   the processes around it (Studio's main process, its GPU process, its other windows) are
     *   shared with everything else Studio has open, so counting them would report Studio.
     */
    scope: "game" | "window";
    processes: GameProcessMemoryEntry[];
    /** The sum of every process's working set, in bytes. */
    workingSetBytes: number;
    /** The sum of every process's private bytes, or null where the platform does not report them. */
    privateBytes: number | null;
};

/**
 * One process as Electron reports it - the fields this reads of `Electron.ProcessMetric`, restated
 * so that code outside the main process can build readings without importing Electron. Sizes are in
 * kilobytes, which is how Electron reports them.
 */
export type GameProcessMetricInput = {
    pid: number;
    type: string;
    name?: string;
    serviceName?: string;
    memory: {
        workingSetSize: number;
        peakWorkingSetSize: number;
        privateBytes?: number;
    };
};

const KIND_BY_ELECTRON_TYPE: Readonly<Record<string, GameProcessKind>> = {
    Browser: "main",
    Tab: "renderer",
    GPU: "gpu",
    Utility: "utility",
};

function kilobytes(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value * 1024) : 0;
}

/**
 * Turn Electron's process list into a reading.
 *
 * `onlyPid` narrows the reading to one process - the Dev Mode window's own renderer - and gives it
 * the `window` scope; without it every process is counted and the scope is `game`. A pid that is
 * not in the list (the window's process was just replaced) yields an empty reading rather than a
 * wrong one.
 */
export function summarizeGameProcessMemory(
    metrics: readonly GameProcessMetricInput[],
    options: { currentPid: number | null; onlyPid?: number | null },
): GameProcessMemoryReading {
    const narrowed = options.onlyPid !== undefined && options.onlyPid !== null;
    const processes: GameProcessMemoryEntry[] = [];
    let workingSetBytes = 0;
    let privateBytes = 0;
    let privateKnown = false;
    for (const metric of metrics) {
        if (narrowed && metric.pid !== options.onlyPid) {
            continue;
        }
        const entry: GameProcessMemoryEntry = {
            kind: KIND_BY_ELECTRON_TYPE[metric.type] ?? "other",
            current: options.currentPid !== null && metric.pid === options.currentPid,
            workingSetBytes: kilobytes(metric.memory?.workingSetSize),
            peakWorkingSetBytes: kilobytes(metric.memory?.peakWorkingSetSize),
        };
        const name = metric.name || metric.serviceName;
        if (name) {
            entry.name = name;
        }
        if (typeof metric.memory?.privateBytes === "number") {
            entry.privateBytes = kilobytes(metric.memory.privateBytes);
            privateBytes += entry.privateBytes;
            privateKnown = true;
        }
        workingSetBytes += entry.workingSetBytes;
        processes.push(entry);
    }
    return {
        scope: narrowed ? "window" : "game",
        processes,
        workingSetBytes,
        privateBytes: privateKnown ? privateBytes : null,
    };
}
