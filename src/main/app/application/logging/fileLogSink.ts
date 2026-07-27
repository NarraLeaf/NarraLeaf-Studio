import fs from "fs";
import path from "path";
import { Logger, type LogEntry } from "@shared/utils/logger";

/** Rotate once the active file passes this size. */
const MAX_LOG_BYTES = 5 * 1024 * 1024;

/** How many rotated files to keep: `main.log` plus `main.1.log` … `main.5.log`. */
const MAX_LOG_FILES = 5;

const LOG_FILE_NAME = "main.log";

function formatLine(entry: LogEntry): string {
    return `${new Date(entry.timestamp).toISOString()} [${entry.level.toUpperCase()}] [${entry.name}] ${entry.message}\n`;
}

/**
 * Write every main-process log line to `<userData>/logs/main.log`, rotating at 5MB and keeping five
 * generations.
 *
 * The point is the *previous* run. When the app dies - a fatal exception, a killed GPU process, a
 * `kill -9` - whatever it printed to a devtools console the user did not have open is gone with it,
 * and the one question worth answering ("what happened just before?") has no evidence behind it.
 *
 * Writes are synchronous on purpose. The last few lines before a crash are the ones that matter,
 * and an async write queued on the way to `process.exit()` never lands.
 */
export function installFileLogSink(logsDir: string): () => void {
    const logPath = path.join(logsDir, LOG_FILE_NAME);

    try {
        fs.mkdirSync(logsDir, { recursive: true });
    } catch (error) {
        console.error("[Logging] Could not create the log directory, file logging is off:", error);
        return () => undefined;
    }

    // Tracked rather than re-stat'ed per line: this runs on every log call, and `statSync` on each
    // one would put a syscall in front of every message.
    let size = 0;
    try {
        size = fs.statSync(logPath).size;
    } catch {
        size = 0;
    }

    const rotate = (): void => {
        try {
            // Drop the oldest, then shift each generation up one, so `main.1.log` is always the
            // most recent completed file.
            fs.rmSync(path.join(logsDir, `main.${MAX_LOG_FILES}.log`), { force: true });
            for (let index = MAX_LOG_FILES - 1; index >= 1; index--) {
                const from = path.join(logsDir, `main.${index}.log`);
                const to = path.join(logsDir, `main.${index + 1}.log`);
                if (fs.existsSync(from)) {
                    fs.renameSync(from, to);
                }
            }
            if (fs.existsSync(logPath)) {
                fs.renameSync(logPath, path.join(logsDir, "main.1.log"));
            }
        } catch (error) {
            console.error("[Logging] Log rotation failed:", error);
        }
        size = 0;
    };

    let failed = false;
    return Logger.addSink(entry => {
        if (failed) {
            return;
        }
        const line = formatLine(entry);
        const lineBytes = Buffer.byteLength(line, "utf-8");
        try {
            if (size + lineBytes > MAX_LOG_BYTES) {
                rotate();
            }
            fs.appendFileSync(logPath, line, { encoding: "utf-8" });
            size += lineBytes;
        } catch (error) {
            // A disk that will not take the log is not worth reporting once per line for the rest
            // of the session.
            failed = true;
            console.error("[Logging] File logging stopped after a write error:", error);
        }
    });
}
