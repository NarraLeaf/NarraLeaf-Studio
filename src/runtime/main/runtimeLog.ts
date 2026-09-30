import fs from "fs";
import path from "path";

/**
 * The game's log file.
 *
 * Until this existed, everything a shipped game had to say went to `console.log` - and a packaged
 * game has no console attached to write to. The engine's warnings, a failed asset, a blueprint
 * error, the crash the player is writing to the author about: all of it was produced, formatted,
 * and dropped. "What happened" had no answer after the fact, on any platform.
 *
 * Bounded on purpose. A game runs for hours and a runaway warning in a loop must cost a fixed
 * amount of the player's disk, so the file rotates once and keeps exactly one previous run's tail.
 */

export type RuntimeLogLevel = "info" | "warning" | "error";

/** Rotate at a megabyte: large enough to hold a whole session, small enough to attach to a report. */
export const RUNTIME_LOG_MAX_BYTES = 1024 * 1024;

export const RUNTIME_LOG_FILE_NAME = "game.log";

/** One line, sortable, with the level readable at a glance. */
export function formatRuntimeLogLine(level: RuntimeLogLevel, message: string, at: Date): string {
    return `${at.toISOString()} [${level.toUpperCase()}] ${message}\n`;
}

/** Where the log for a given profile lives. Exported so the crash paths can name it. */
export function runtimeLogPath(userDataDir: string): string {
    return path.join(userDataDir, "logs", RUNTIME_LOG_FILE_NAME);
}

/** How one line is written. */
export interface RuntimeLogLineOptions {
    /**
     * `false` to write the line to the file and not to the console as well.
     *
     * For a caller that puts the same line on standard error itself, in its own shape - a launch that
     * is being refused (see `startupRefusal`) - and would otherwise print it twice wherever the console
     * is live: a preview, a test run, a shipped game started with the logs switch.
     */
    console?: boolean;
}

export interface RuntimeLogSink {
    (level: RuntimeLogLevel, message: string, options?: RuntimeLogLineOptions): void;
}

/**
 * Start writing to `<userData>/logs/game.log`, and hand back the writer.
 *
 * Synchronous appends: the volume is low, and the one line worth having is the one written as the
 * process is going down - which is exactly the line an asynchronous write loses. Every failure
 * path here degrades to "console only" rather than throwing, because a game must not fail to run
 * over a log it cannot write.
 */
export function installRuntimeLogSink(userDataDir: string): RuntimeLogSink {
    const filePath = runtimeLogPath(userDataDir);
    const rotatedPath = `${filePath}.1`;
    let bytes = 0;
    let writable = true;

    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        bytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    } catch {
        writable = false;
    }

    const rotate = (): void => {
        try {
            fs.rmSync(rotatedPath, { force: true });
            fs.renameSync(filePath, rotatedPath);
            bytes = 0;
        } catch {
            // A rotation that cannot happen must not stop the writing; the cap is a courtesy to
            // the player's disk, not a correctness property.
            bytes = 0;
        }
    };

    return (level, message, options) => {
        // Preview keeps its console: Studio reads the game's stdout to fill its own console panel,
        // and that is how an author sees a warning while they are still writing the scene.
        if (options?.console !== false) {
            const sink = level === "error" ? "error" : level === "warning" ? "warn" : "log";
            console[sink](`[GameRuntime] ${message}`);
        }

        if (!writable) {
            return;
        }
        const line = formatRuntimeLogLine(level, message, new Date());
        try {
            if (bytes >= RUNTIME_LOG_MAX_BYTES) {
                rotate();
            }
            fs.appendFileSync(filePath, line, "utf-8");
            bytes += Buffer.byteLength(line, "utf-8");
        } catch {
            // A disk that filled up, a profile directory that was removed underneath the game.
            // Stop trying rather than throwing once per line for the rest of the session.
            writable = false;
        }
    };
}
