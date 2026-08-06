import fs from "fs/promises";
import path from "path";

/**
 * Locating the vendored ffmpeg/ffprobe binaries.
 *
 * Same discipline as `zsignTool.ts`, and for the same reason: the payload is fetched while *Studio*
 * is being built (`project/build/prepare-ffmpeg.js`) and copied into the installer by the
 * per-platform `extraResources` blocks in `electron-builder.yml`. Resolution here is a lookup, never
 * a fetch. An author importing a video must not be waiting on a download, and must not need a
 * toolchain on their machine.
 *
 * ## The licence constraint is load-bearing
 *
 * Only an **LGPL** FFmpeg build may be staged. A GPL build (the kind that carries libx264/libx265)
 * would make the whole installer GPL, which is a distribution decision this pipeline is not
 * entitled to make. The project's transcode target — VP9 video, Vorbis audio — needs libvpx and
 * libvorbis, both BSD, so an LGPL build is sufficient and nothing is lost.
 *
 * That constraint is why {@link ffmpegHostTarget} has fewer rows than one might expect. See the
 * comment on the table.
 */

/** Upstream build we vendor. Mirrors FFMPEG_VERSION in project/build/prepare-ffmpeg.js. */
export const FFMPEG_VERSION = "n8.1.2-34-g9b6c8969e0";

/**
 * Escape hatch for hosts the vendoring cannot serve — macOS above all, which has no LGPL build to
 * pin. Set it to a **directory** holding both binaries (not to a single file, as the zsign override
 * does) and they are used verbatim, on any platform.
 *
 * Anyone using it on a machine that ships a product build is responsible for the licence of what
 * they point it at.
 */
export const FFMPEG_DIR_ENV = "NLS_FFMPEG_DIR";

/** The two binaries, named as callers ask for them. */
export type FfmpegBinaryName = "ffmpeg" | "ffprobe";

/**
 * The subset of `App` this module needs. `App` satisfies it structurally, so main passes itself; a
 * duck-typed seam keeps this file free of electron imports and makes it testable with a two-method
 * stub.
 */
export type FfmpegResolverApp = {
    isPackaged(): boolean;
    resolveResource(p: string): string;
};

export type FfmpegHostTarget = {
    /** Directory name under `resources/ffmpeg/`, keyed by `process.platform`. */
    platformKey: string;
    /** Suffix the staging script writes the binaries under. */
    executableSuffix: string;
};

/**
 * Which hosts the vendoring covers.
 *
 * **macOS is absent, and that is a pending decision rather than an oversight.** BtbN/FFmpeg-Builds
 * — the LGPL source used for Windows and Linux — publishes no macOS asset at all, and every
 * mainstream macOS FFmpeg distribution is GPL (evermeet.cx, osxexperts.net, Homebrew's formula, and
 * the popular npm and PyPI wrappers all configure with `--enable-gpl --enable-libx264
 * --enable-libx265`). Two genuinely LGPL macOS builds do exist, and neither is a drop-in: one is
 * current but dynamically linked against a large dependency closure, the other is static but frozen
 * on a 2023 FFmpeg snapshot. Choosing between them is a distribution call for the project to make.
 * Until it is made this row stays empty and conversion reports as unavailable on macOS — the same
 * posture iOS signing already takes on hosts zsign does not serve. The evidence and the two
 * candidates are written up on the ASSETS table in `project/build/prepare-ffmpeg.js`.
 *
 * Kept in step with the ASSETS table in `project/build/prepare-ffmpeg.js`.
 */
export function ffmpegHostTarget(
    platform: string = process.platform,
    arch: string = process.arch,
): FfmpegHostTarget | null {
    if (platform === "win32" && arch === "x64") {
        return { platformKey: "win32", executableSuffix: ".exe" };
    }
    if (platform === "linux" && arch === "x64") {
        return { platformKey: "linux", executableSuffix: "" };
    }
    return null;
}

export type FfmpegUnavailableReason =
    /** No LGPL build exists for this platform/arch pair; nothing was ever staged. */
    | "host-unsupported"
    /** Supported host, but the binary is not on disk (the staging step never ran). */
    | "not-staged";

export type FfmpegTool =
    | { available: true; path: string }
    | {
        available: false;
        reason: FfmpegUnavailableReason;
        /** One sentence for a log. UI copy is the caller's business. */
        detail: string;
        /** Absolute paths that were looked at, in order. Empty when the host is unsupported. */
        searched: string[];
    };

export type FfmpegResolveOptions = {
    platform?: string;
    arch?: string;
    env?: Record<string, string | undefined>;
};

/**
 * Where a binary is looked for, in order. A packaged Studio has exactly one candidate; development
 * adds a `.dev` cache fallback, which is both where a checkout that never ran the staging script
 * can be served from and where someone on an unserved host can drop their own build without
 * touching a tracked path.
 */
export function ffmpegSearchPaths(
    app: FfmpegResolverApp,
    target: FfmpegHostTarget,
    binary: FfmpegBinaryName,
): string[] {
    const fileName = `${binary}${target.executableSuffix}`;
    const staged = app.resolveResource(path.join("ffmpeg", target.platformKey, fileName));
    if (app.isPackaged()) {
        return [staged];
    }
    return [
        staged,
        app.resolveResource(path.join("..", ".dev", "cache", "ffmpeg", target.platformKey, fileName)),
    ];
}

async function isFile(candidate: string): Promise<boolean> {
    try {
        return (await fs.stat(candidate)).isFile();
    } catch {
        return false;
    }
}

/**
 * Resolve one of the vendored binaries for this host.
 *
 * Never throws and never touches the network. `available: false` is an ordinary outcome, not an
 * error: a Studio that cannot transcode still imports every file the engine can already play, and
 * the import flow needs a verdict while a dialog is open rather than an exception.
 */
export async function resolveFfmpegBinary(
    app: FfmpegResolverApp,
    binary: FfmpegBinaryName,
    options: FfmpegResolveOptions = {},
): Promise<FfmpegTool> {
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    const env = options.env ?? process.env;

    const overrideDir = env[FFMPEG_DIR_ENV]?.trim();
    if (overrideDir) {
        // The suffix follows the *host*, not the staging table: the override exists precisely for
        // hosts with no row, and on Windows the binary is still `.exe` there.
        const suffix = platform === "win32" ? ".exe" : "";
        const candidate = path.join(overrideDir, `${binary}${suffix}`);
        if (await isFile(candidate)) {
            return { available: true, path: candidate };
        }
        return {
            available: false,
            reason: "not-staged",
            detail: `${FFMPEG_DIR_ENV} points at ${overrideDir}, which holds no ${binary}${suffix}`,
            searched: [candidate],
        };
    }

    const target = ffmpegHostTarget(platform, arch);
    if (target === null) {
        return {
            available: false,
            reason: "host-unsupported",
            detail:
                `no LGPL-licensed FFmpeg build is vendored for ${platform}-${arch}, so media conversion `
                + `is unavailable here; set ${FFMPEG_DIR_ENV} to a directory holding ffmpeg and ffprobe `
                + "to enable it",
            searched: [],
        };
    }

    const searched = ffmpegSearchPaths(app, target, binary);
    for (const candidate of searched) {
        if (await isFile(candidate)) {
            return { available: true, path: candidate };
        }
    }
    return {
        available: false,
        reason: "not-staged",
        detail:
            `the bundled ${binary} is missing (looked in ${searched.join(", ")}); `
            + "run project/build/prepare-ffmpeg.js to stage it",
        searched,
    };
}
