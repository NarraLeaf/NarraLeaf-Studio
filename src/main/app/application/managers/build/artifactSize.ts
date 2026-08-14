import fs from "fs/promises";
import path from "path";
import type { Translator } from "@shared/i18n";
import { totalGameBuildArtifactBytes, type GameBuildArtifactSize } from "@shared/types/gameBuild";
import { formatBytes } from "@shared/utils/formatBytes";
import { Fs } from "@shared/utils/fs";

/**
 * How big the build's output actually is, measured once the packaging worker has written it.
 *
 * The reason this exists: an author finds out their game is 4 GB from the storefront they uploaded
 * it to, because nothing between "Build" and the upload ever said a number.
 *
 * Two things make it more than a `stat` loop:
 *
 *  - **Several artifacts are directories, not files.** The web export writes a folder, a macOS
 *    `.app` is a folder, and the desktop "dir" format is the unpacked tree. `stat` on a directory
 *    reports the size of the directory entry (a few hundred bytes on most filesystems), so a
 *    900 MB web export would be reported as roughly nothing - the one failure mode this feature
 *    cannot have, since it is exactly the artifact whose size surprises people.
 *  - **Measuring must never fail a build.** Everything here is best-effort, the same posture the
 *    output-folder reveal takes: a build that succeeded is not turned into a failure because a file
 *    was locked, deleted between the write and the walk, or sits behind a permission the packaging
 *    step did not need. Nothing in this module rejects.
 */

/**
 * Measure every artifact. Result order matches the input, and every input path appears in the
 * output - one that could not be measured carries no `bytes` rather than being dropped, so a caller
 * listing the results still lists everything the build produced.
 *
 * Never rejects.
 */
export async function measureBuildArtifacts(artifacts: string[]): Promise<GameBuildArtifactSize[]> {
    return await Promise.all(artifacts.map(async (artifactPath): Promise<GameBuildArtifactSize> => {
        const bytes = await measureArtifact(artifactPath);
        return bytes === null ? { path: artifactPath } : { path: artifactPath, bytes };
    }));
}

/**
 * One artifact's size in bytes, or `null` when it cannot be read.
 *
 * A directory is summed over its whole tree through the same walk the asset overview uses, which
 * already absorbs its own per-entry failures (an unreadable subdirectory counts as empty). The
 * `try` still wraps it, because "never rejects" has to hold against that walk changing its mind
 * about throwing rather than against its behaviour today.
 */
async function measureArtifact(artifactPath: string): Promise<number | null> {
    try {
        // `stat`, not `lstat`: a symlinked artifact should be measured as the thing it points at,
        // which is what the packaged bytes are.
        const stats = await fs.stat(artifactPath);
        if (stats.isDirectory()) {
            return (await Fs.directorySize(artifactPath)).totalBytes;
        }
        return stats.size;
    } catch {
        return null;
    }
}

/**
 * The size report printed under a finished build: one line per artifact, then one total line.
 *
 * Paths are shown relative to the project, matching how the finished-build line has always listed
 * them. Sizes use the shared binary-unit formatting so a number here means the same thing as the
 * same number in the cache listing or the asset browser.
 *
 * The total covers only the artifacts that could be measured, and says how many those were, so a
 * build with one unreadable artifact reports a total that is true about what it counted instead of
 * a smaller number presented as the whole. With nothing measurable at all there is no total line -
 * "0 B" would be a claim about the build rather than about the reading.
 */
export function formatArtifactSizeReport(
    sizes: GameBuildArtifactSize[],
    projectPath: string,
    translator: Translator,
): string {
    const lines = sizes.map((size) => {
        const label = path.relative(projectPath, size.path);
        return size.bytes === undefined
            ? `${label} (${translator.t("build.size.unknown")})`
            : `${label} (${formatBytes(size.bytes)})`;
    });
    const measured = sizes.filter((size) => size.bytes !== undefined);
    if (measured.length > 0) {
        lines.push(translator.t(
            measured.length === 1 ? "build.size.totalOne" : "build.size.totalMany",
            { size: formatBytes(totalGameBuildArtifactBytes(measured)), count: measured.length },
        ));
    }
    return lines.join("\n");
}
