import fs from "fs";
import path from "path";
import { RUNTIME_LOG_FILE_NAME, runtimeLogPath } from "./runtimeLog";
import type { GameCrashReportRequest, GameCrashReportResult } from "@shared/types/gameRuntime";

/**
 * The one file a player can send after a crash.
 *
 * The crash screen already showed the failure, offered a copy button and named the log. What it
 * could not do was produce something to hand over: the player had a folder path and a clipboard,
 * and the author got whatever they managed to paste - usually the top of a stack, never the lines
 * before it. This gathers the log and everything the shell knows about the build it came from into
 * one text file, written where the player is standing and shown to them in their file manager.
 *
 * Nothing leaves the machine. The file is written and revealed; where it goes next is the player's
 * business, through whatever they already use to talk to the author.
 *
 * WHAT IS DELIBERATELY NOT IN IT
 * A crash report is a privacy surface, and the player is not reading it before they send it. So it
 * carries the failure and the machinery around it, and nothing about the person:
 *  - no saved games, no playthrough variables, no list of what has been played or unlocked;
 *  - no machine or account name - every occurrence of the player's home directory is replaced with
 *    `~`, which covers the log path, the app dir of a per-user install, and any path a stack quotes;
 *  - no system language list, only the one language the shell resolved to speak;
 *  - no network, hardware or display inventory, none of which a story crash is about;
 *  - nothing from the previous run: the rotated `game.log.1` is left where it is.
 *
 * The text is English, like the log inside it. The reader is the author, whose language the game has
 * no way of knowing; the player's own language decides the screen that produced the file, not the
 * file.
 */

export const CRASH_REPORT_FILE_NAME = "crash-report.txt";

/**
 * How much of the log travels: the end of it, where the crash is.
 *
 * The log rotates at a megabyte, but a rotation that cannot happen keeps writing anyway - by design,
 * because a cap is a courtesy and losing the lines is not - so the file on disk has no hard bound
 * and this must supply its own. A quarter of a megabyte is a long session's tail and still an
 * attachment anyone can send.
 */
export const CRASH_REPORT_LOG_TAIL_BYTES = 256 * 1024;

/** What the pack said about the build, once anything has read it. */
export type CrashReportBuild = {
    gameName: string | null;
    gameVersion: string | null;
    /** The version of Studio that produced the pack (`pack.runtimeVersion`). */
    studioVersion: string | null;
    /** The narraleaf-react version bundled into the runtime this pack ships with. */
    engineVersion: string | null;
    mode: string | null;
    builtAt: string | null;
    projectRevision: { id: string; number: number } | null;
};

/** What the process running the game knows about the machine it is running on. */
export type CrashReportMachine = {
    platform: string;
    arch: string;
    osRelease: string;
    electron: string | null;
    chrome: string | null;
};

export type CrashReportLog = {
    /** The log's own path, as it will be shown - redaction happens with everything else. */
    path: string;
    text: string;
    /** Bytes of the log this tail carries, and how many the whole file holds. */
    bytes: number;
    totalBytes: number;
};

export type CrashReportInput = {
    at: Date;
    request: GameCrashReportRequest;
    /** Null before anything has read the pack, which is exactly when a boot failure is reported. */
    build: CrashReportBuild | null;
    machine: CrashReportMachine;
    /** Null when the log could not be read at all; the report is still worth writing without it. */
    log: CrashReportLog | null;
    /** Replaced with `~` throughout. */
    homeDirectory: string;
};

/** Everything unstated reads the same way: this build does not say. */
const UNSTATED = "not stated";

function field(label: string, value: string): string {
    return `${label.padEnd(16)}${value}`;
}

/**
 * Every occurrence of the player's home directory, in either separator form and whatever case the
 * platform reported it in, replaced with `~`.
 *
 * Applied to the whole file rather than to the fields that obviously carry a path: the log lines and
 * the stack are written by code that never considered who would read them, and they are where a user
 * name actually turns up. A player sending this should not be handing over the name of their
 * account to learn that their game crashed.
 */
export function redactHomeDirectory(text: string, homeDirectory: string): string {
    const base = homeDirectory.replace(/[\\/]+$/, "");
    if (!base) {
        return text;
    }
    const variants = new Set([base, base.replace(/\\/g, "/"), base.replace(/\//g, "\\")]);
    let redacted = text;
    for (const variant of variants) {
        const pattern = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        redacted = redacted.replace(new RegExp(pattern, "gi"), "~");
    }
    return redacted;
}

/**
 * The end of a UTF-8 buffer, decoded without cutting a character in half.
 *
 * A byte offset lands anywhere, and a tail that starts inside a multi-byte sequence opens with a
 * replacement character - in Japanese or Chinese, several. Continuation bytes are dropped until the
 * first byte that starts a character.
 */
function decodeTail(buffer: Buffer): string {
    let start = 0;
    while (start < buffer.length && (buffer[start] & 0b1100_0000) === 0b1000_0000) {
        start += 1;
    }
    return buffer.subarray(start).toString("utf-8");
}

/**
 * The tail of the log, and how much of it was left behind.
 *
 * Read through a file handle at an offset rather than by loading the file and slicing it: the log
 * has no guaranteed ceiling, and a report about a crash must not be the thing that runs the machine
 * out of memory.
 */
export function readLogTail(filePath: string, maxBytes: number): CrashReportLog | null {
    let handle: number | null = null;
    try {
        const size = fs.statSync(filePath).size;
        const length = Math.min(size, maxBytes);
        const buffer = Buffer.alloc(length);
        handle = fs.openSync(filePath, "r");
        fs.readSync(handle, buffer, 0, length, size - length);
        return {
            path: filePath,
            text: length === size ? buffer.toString("utf-8") : decodeTail(buffer),
            bytes: length,
            totalBytes: size,
        };
    } catch {
        // No log yet, a profile directory that went away, a disk that will not answer. The report
        // still states the build and the failure, which is more than the player had before.
        return null;
    } finally {
        if (handle !== null) {
            try {
                fs.closeSync(handle);
            } catch {
                /* Closing a handle that is already gone. */
            }
        }
    }
}

/** The file's text. Pure, so what it says can be read in a test rather than inferred from a run. */
export function formatCrashReport(input: CrashReportInput): string {
    const { build, machine, log, request } = input;
    const lines: string[] = [
        "NarraLeaf crash report",
        "",
        "Send this file to whoever made the game. It is written on this machine and sent nowhere.",
        "",
        field("Written", input.at.toISOString()),
        field("Game", [build?.gameName, build?.gameVersion].filter(Boolean).join(" ") || UNSTATED),
        field("Studio", build?.studioVersion ?? UNSTATED),
        field("Engine", build?.engineVersion ?? UNSTATED),
        field("Build", build?.mode ?? UNSTATED),
        field("Built", build?.builtAt ?? UNSTATED),
        field(
            "Project state",
            build?.projectRevision
                ? `${build.projectRevision.id} (#${build.projectRevision.number})`
                : UNSTATED,
        ),
        field("Platform", `${machine.platform} ${machine.arch}, ${machine.osRelease}`),
        field(
            "Runtime",
            [
                machine.electron ? `Electron ${machine.electron}` : null,
                machine.chrome ? `Chromium ${machine.chrome}` : null,
            ].filter(Boolean).join(", ") || UNSTATED,
        ),
        field("Language", request.language || UNSTATED),
        // Absent rather than "unknown" so the two cases stay distinguishable: a run that never
        // reached a story, and one whose page the shell drew after the display process died.
        field("Story", request.story ? request.story.storyName : "nothing was running"),
        ...(request.story ? [field("Scene", request.story.sceneName)] : []),
        ...(request.story?.rowId ? [field("Row", request.story.rowId)] : []),
        "",
        "Failure",
        "-------",
        request.details.trim() || UNSTATED,
        "",
    ];

    if (log) {
        lines.push(
            log.bytes < log.totalBytes
                ? `Log (${RUNTIME_LOG_FILE_NAME}, last ${log.bytes} of ${log.totalBytes} bytes)`
                : `Log (${RUNTIME_LOG_FILE_NAME})`,
            "---",
            log.path,
            "",
            log.text.trimEnd(),
            "",
        );
    } else {
        lines.push("Log", "---", "The log could not be read.", "");
    }

    return redactHomeDirectory(lines.join("\n"), input.homeDirectory);
}

/** Where the report is written: beside the log, which is the folder this game writes about itself in. */
export function crashReportPath(userDataDir: string): string {
    return path.join(path.dirname(runtimeLogPath(userDataDir)), CRASH_REPORT_FILE_NAME);
}

export type WriteCrashReportOptions = {
    userDataDir: string;
    request: GameCrashReportRequest;
    build: CrashReportBuild | null;
    machine: CrashReportMachine;
    homeDirectory: string;
    now?: () => Date;
    /** Best effort, and never the thing that fails the write: the file exists either way. */
    reveal?: (filePath: string) => void;
};

/**
 * Write the report and show it to the player.
 *
 * One file, overwritten. A player sends the crash they are looking at, and a folder accumulating
 * timestamped files would make them choose which - a choice nobody outside this repository can make
 * correctly. When it matters which crash this was, the file says so on its second line.
 *
 * The failure is returned rather than thrown. Everything else on the crash screen has to keep
 * working when this cannot: a disk that is full is not a reason to take away the copy button.
 */
export function writeCrashReport(options: WriteCrashReportOptions): GameCrashReportResult {
    const filePath = crashReportPath(options.userDataDir);
    const text = formatCrashReport({
        at: (options.now ?? (() => new Date()))(),
        request: options.request,
        build: options.build,
        machine: options.machine,
        log: readLogTail(runtimeLogPath(options.userDataDir), CRASH_REPORT_LOG_TAIL_BYTES),
        homeDirectory: options.homeDirectory,
    });
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        // Written straight to the destination, not through a temporary file: a user directory on
        // Windows can refuse a rename (see `windowGeometry`), and a report torn in half is a report
        // whose reader can see it is torn.
        fs.writeFileSync(filePath, text, "utf-8");
    } catch (error) {
        return { outcome: "failed", error: error instanceof Error ? error.message : String(error) };
    }
    try {
        options.reveal?.(filePath);
    } catch {
        // A platform with no file manager to open, or one that refused. The screen names the path,
        // which is what the player needs; the file is already there.
    }
    return { outcome: "written", path: filePath };
}
