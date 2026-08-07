import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import type { ExecFileException } from "child_process";
import { isTimeout, probeMediaFile, type ProbeRunner } from "./mediaProbe";
import { ffmpegHostTarget, resolveFfmpegBinary, type FfmpegResolverApp } from "./ffmpegTool";

/**
 * The error arms, and only the error arms.
 *
 * What ffprobe *means* is tested in `@shared/utils/mediaSupport.test.ts`, against reports rather
 * than processes. What is left here is everything that can go wrong between "we have a file path"
 * and "we have JSON" - and each of those is a different thing to tell the author, which is why
 * they are separate arms rather than one caught exception.
 */

/**
 * An `App` stand-in whose resources directory is a path that certainly holds no binaries, so
 * resolution fails the way it would on a checkout that never ran the staging script.
 */
const missingToolApp: FfmpegResolverApp = {
    isPackaged: () => true,
    resolveResource: (p: string) => path.join("/nonexistent-resources", p),
};

/** An app that claims the staged binary is right here - this file, which certainly exists. */
const presentToolApp: FfmpegResolverApp = {
    isPackaged: () => true,
    resolveResource: () => __filename,
};

/** A runner that must never be reached. */
const forbiddenRunner: ProbeRunner = () => {
    throw new Error("the probe spawned a process when it should not have");
};

function runner(result: Partial<Awaited<ReturnType<ProbeRunner>>>): ProbeRunner {
    return async () => ({ stdout: "", timedOut: false, error: null, ...result });
}

/**
 * The error object Node's `execFile` really produces when the child exits non-zero.
 *
 * Written out in full because the fields that are easy to omit are the ones that matter:
 * `signal` is **null**, not undefined, and `killed` is **false**. A mock that leaves them out
 * made the first version of `isTimeout` pass its unit tests while reporting every unreadable file
 * as a 15-second stall on the real binary.
 */
function exitError(code: number): ExecFileException {
    return Object.assign(new Error(`Command failed with exit code ${code}`), {
        code,
        killed: false,
        signal: null,
    }) as unknown as ExecFileException;
}

/** The error object Node produces when its own timeout fires. */
function timeoutError(): ExecFileException {
    return Object.assign(new Error("Command failed"), {
        killed: true,
        signal: "SIGTERM",
    }) as unknown as ExecFileException;
}

describe("probeMediaFile / binary missing", () => {
    it("reports unavailable rather than throwing, and names where it looked", async () => {
        const outcome = await probeMediaFile(missingToolApp, "/assets/clip.mp4", {
            platform: "win32",
            arch: "x64",
            env: {},
            run: forbiddenRunner,
        });
        expect(outcome.status).toBe("unavailable");
        if (outcome.status !== "unavailable") return;
        expect(outcome.searched.length).toBeGreaterThan(0);
        expect(outcome.detail).toContain("prepare-ffmpeg.js");
    });

    it("reports unavailable on a host with no LGPL build, without looking anywhere", async () => {
        // Intel macOS: the binaries are compiled from source there and that needs nasm, so nothing
        // is ever staged for this pair.
        const outcome = await probeMediaFile(missingToolApp, "/assets/clip.mp4", {
            platform: "darwin",
            arch: "x64",
            env: {},
            run: forbiddenRunner,
        });
        expect(outcome.status).toBe("unavailable");
        if (outcome.status !== "unavailable") return;
        // Nothing was ever staged there, so there is nothing to have looked at.
        expect(outcome.searched).toEqual([]);
        expect(outcome.detail).toContain("LGPL");
    });

    it("does not confuse a missing binary with a broken file", async () => {
        const outcome = await probeMediaFile(missingToolApp, "/assets/clip.mp4", {
            platform: "win32",
            arch: "x64",
            env: {},
            run: forbiddenRunner,
        });
        // The distinction the arms exist for: nothing is wrong with the file.
        expect(outcome.status).not.toBe("failed");
    });
});

describe("probeMediaFile / process failures", () => {
    const options = { platform: "win32" as const, arch: "x64" as const, env: {} };

    it("reports a timeout as a timeout", async () => {
        const outcome = await probeMediaFile(presentToolApp, "/assets/slow.mp4", {
            ...options,
            timeoutMs: 250,
            run: runner({ timedOut: true, error: timeoutError() }),
        });
        expect(outcome).toMatchObject({ status: "failed", reason: "timeout" });
        if (outcome.status !== "failed") return;
        expect(outcome.detail).toContain("250ms");
    });

    it("reports a non-zero exit with no output as `exited`", async () => {
        const outcome = await probeMediaFile(presentToolApp, "/assets/gone.mp4", {
            ...options,
            run: runner({ stdout: "", error: exitError(1) }),
        });
        expect(outcome).toMatchObject({ status: "failed", reason: "exited" });
    });

    it("reports output that is not JSON as malformed", async () => {
        const outcome = await probeMediaFile(presentToolApp, "/assets/clip.mp4", {
            ...options,
            run: runner({ stdout: "Segmentation fault" }),
        });
        expect(outcome).toMatchObject({ status: "failed", reason: "malformed-output" });
    });

    it("reports a runner that cannot start the process as spawn-failed", async () => {
        const outcome = await probeMediaFile(presentToolApp, "/assets/clip.mp4", {
            ...options,
            run: () => Promise.reject(new Error("EACCES")),
        });
        expect(outcome).toMatchObject({ status: "failed", reason: "spawn-failed" });
        if (outcome.status !== "failed") return;
        expect(outcome.detail).toContain("EACCES");
    });

    it("refuses rather than failing when ffprobe exits non-zero but still prints its empty object", async () => {
        // Measured: for a missing file, a text file and a playlist alike, ffprobe exits 1 and
        // prints "{\n\n}". Reading the exit code first would turn "this is not a media file" into
        // an error message about an exit code.
        const outcome = await probeMediaFile(presentToolApp, "/assets/notes.txt", {
            ...options,
            run: runner({ stdout: "{\n\n}", error: exitError(1) }),
        });
        expect(outcome.status).toBe("probed");
        if (outcome.status !== "probed") return;
        expect(outcome.verdict.tier).toBe("refuse");
        expect(outcome.verdict.reason).toBe("no-streams");
    });
});

describe("isTimeout", () => {
    it("is false for an ordinary non-zero exit", () => {
        // The regression this exists for: `signal` is null there, and `null !== undefined`, so a
        // loose test reported every unreadable file as a timeout. Caught only by the real binary.
        expect(isTimeout(exitError(1))).toBe(false);
    });

    it("is true when Node's own timeout fired", () => {
        expect(isTimeout(timeoutError())).toBe(true);
    });

    it("is false when the output cap was hit, which is not a stall", () => {
        const capped = Object.assign(new Error("stdout maxBuffer exceeded"), {
            code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
            killed: true,
            signal: "SIGTERM",
        }) as unknown as ExecFileException;
        // Falls through to the parse step instead, where truncated JSON reads as malformed output.
        expect(isTimeout(capped)).toBe(false);
    });

    it("is false when nothing went wrong", () => {
        expect(isTimeout(null)).toBe(false);
    });
});

describe("probeMediaFile / success and short-circuits", () => {
    const options = { platform: "win32" as const, arch: "x64" as const, env: {} };

    it("classifies a real report", async () => {
        const outcome = await probeMediaFile(presentToolApp, "/assets/clip.mp4", {
            ...options,
            run: runner({
                stdout: JSON.stringify({
                    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
                    streams: [{ index: 0, codec_type: "video", codec_name: "hevc" }],
                }),
            }),
        });
        expect(outcome.status).toBe("probed");
        if (outcome.status !== "probed") return;
        expect(outcome.verdict.tier).toBe("reencode");
    });

    it("passes the path as a lone argv element, never through a shell", async () => {
        let seen: string[] = [];
        await probeMediaFile(presentToolApp, "/assets/a b; rm -rf x.mp4", {
            ...options,
            run: async (_binary, args) => {
                seen = args;
                return { stdout: "{}", timedOut: false, error: null };
            },
        });
        expect(seen[seen.length - 1]).toBe("/assets/a b; rm -rf x.mp4");
        expect(seen).toContain("-print_format");
    });

    it("refuses a playlist by name without resolving or spawning anything", async () => {
        // Not an optimisation: FFmpeg resolves playlist entries, and an entry can be an http:// URL.
        const outcome = await probeMediaFile(missingToolApp, "/assets/stream.m3u8", {
            ...options,
            run: forbiddenRunner,
        });
        expect(outcome.status).toBe("probed");
        if (outcome.status !== "probed") return;
        expect(outcome.verdict.tier).toBe("refuse");
        expect(outcome.verdict.reason).toBe("not-media");
    });
});

describe("resolveFfmpegBinary", () => {
    it("serves the hosts an LGPL build exists for, and no others", () => {
        expect(ffmpegHostTarget("win32", "x64")).toEqual({ platformKey: "win32", executableSuffix: ".exe" });
        expect(ffmpegHostTarget("linux", "x64")).toEqual({ platformKey: "linux", executableSuffix: "" });
        // Apple Silicon is served by a from-source build; Intel macOS is not, because that build
        // would need nasm for libvpx's x86 SIMD.
        expect(ffmpegHostTarget("darwin", "arm64")).toEqual({ platformKey: "darwin", executableSuffix: "" });
        expect(ffmpegHostTarget("darwin", "x64")).toBeNull();
        expect(ffmpegHostTarget("win32", "arm64")).toBeNull();
    });

    it("takes the env override, which is the only way to serve an unlisted host", async () => {
        // linux-arm64 has no row in the table, so nothing but the override can answer here.
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-ffmpeg-"));
        try {
            const binary = path.join(dir, "ffprobe");
            await fs.writeFile(binary, "");
            const tool = await resolveFfmpegBinary(missingToolApp, "ffprobe", {
                platform: "linux",
                arch: "arm64",
                env: { NLS_FFMPEG_DIR: dir },
            });
            expect(tool).toEqual({ available: true, path: binary });
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it("looks for the .exe form of the override on Windows", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-ffmpeg-"));
        try {
            await fs.writeFile(path.join(dir, "ffprobe.exe"), "");
            const tool = await resolveFfmpegBinary(missingToolApp, "ffprobe", {
                platform: "win32",
                arch: "arm64",
                env: { NLS_FFMPEG_DIR: dir },
            });
            expect(tool.available).toBe(true);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it("says so when the override points somewhere the binary is not", async () => {
        const tool = await resolveFfmpegBinary(missingToolApp, "ffprobe", {
            platform: "linux",
            arch: "x64",
            env: { NLS_FFMPEG_DIR: "/nowhere" },
        });
        expect(tool.available).toBe(false);
        if (tool.available) return;
        expect(tool.reason).toBe("not-staged");
        expect(tool.detail).toContain("/nowhere");
    });

    it("offers a development fallback path that a packaged build does not", async () => {
        const dev = await resolveFfmpegBinary(
            { isPackaged: () => false, resolveResource: (p: string) => path.join("/nonexistent-resources", p) },
            "ffprobe",
            { platform: "win32", arch: "x64", env: {} },
        );
        const packaged = await resolveFfmpegBinary(missingToolApp, "ffprobe", {
            platform: "win32",
            arch: "x64",
            env: {},
        });
        expect(dev.available).toBe(false);
        expect(packaged.available).toBe(false);
        if (dev.available || packaged.available) return;
        expect(dev.searched).toHaveLength(2);
        expect(packaged.searched).toHaveLength(1);
    });
});
