/**
 * Pure projection: a finished build's snapshot -> the rows the report draws.
 *
 * React-free so the arithmetic can be tested directly. The numbers are the point of the page: an
 * author reads the excluded list to check that nothing they meant to ship is on it, and a total that
 * disagrees with the list underneath it is worse than no total at all.
 */

import type { Translator } from "@shared/i18n";
import type {
    GameBuildStateSnapshot,
    ShippedAssetReport,
    ShippedAssetReportEntry,
} from "@shared/types/gameBuild";
import { totalShippedAssetBytes } from "@shared/types/gameBuild";

/** One artifact of a finished run, paired with what it came to on disk. */
export interface BuildArtifactRow {
    /** Absolute path, as the build wrote it. */
    path: string;
    /** Last path segment - what the file is called in the output folder. */
    name: string;
    /** Absent where the size could not be read, which is a different fact from zero. */
    bytes?: number;
}

/** One asset type's slice of a report list. */
export interface ShippedAssetGroup {
    /** The asset library shard the entries belong to - `image`, `audio`, `font` and so on. */
    type: string;
    entries: ShippedAssetReportEntry[];
    /** Bytes over the entries whose size could be read. */
    bytes: number;
}

/**
 * The last segment of a path, whichever separator the platform wrote.
 *
 * Both spellings are handled because the snapshot travels from the main process, which builds for
 * Windows and for POSIX hosts out of the same renderer.
 */
export function artifactFileName(path: string): string {
    const segments = path.split(/[\\/]/).filter(segment => segment.length > 0);
    return segments[segments.length - 1] ?? path;
}

/**
 * The artifacts of a finished run, in the order the build reported them.
 *
 * Sizes are matched by path rather than by position: `artifactSizes` is documented as parallel to
 * `artifacts`, and a lookup that survives one of them being short is cheaper than a wrong number
 * beside a file name.
 */
export function buildArtifactRows(state: GameBuildStateSnapshot): BuildArtifactRow[] {
    const bytesByPath = new Map<string, number>();
    for (const size of state.artifactSizes ?? []) {
        if (size.bytes !== undefined) {
            bytesByPath.set(size.path, size.bytes);
        }
    }
    return (state.artifacts ?? []).map(path => {
        const bytes = bytesByPath.get(path);
        return bytes === undefined
            ? { path, name: artifactFileName(path) }
            : { path, name: artifactFileName(path), bytes };
    });
}

/** Bytes over the artifacts whose size could be read; unmeasured ones contribute nothing. */
export function totalArtifactBytes(rows: readonly BuildArtifactRow[]): number {
    return rows.reduce((total, row) => total + (row.bytes ?? 0), 0);
}

/**
 * Entries whose name, id or type contains the query, compared case-insensitively.
 *
 * An empty or blank query returns everything: the search box is a filter, not a gate.
 */
export function filterShippedAssets(
    entries: readonly ShippedAssetReportEntry[],
    query: string,
): ShippedAssetReportEntry[] {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return [...entries];
    }
    return entries.filter(entry =>
        entry.name.toLowerCase().includes(needle)
        || entry.id.toLowerCase().includes(needle)
        || entry.type.toLowerCase().includes(needle));
}

/**
 * Entries grouped by asset type, heaviest group first, heaviest entry first inside each.
 *
 * Both orders are by size because the question the list answers is which one asset is worth going
 * and looking at: an excluded 40 MB video matters and forty excluded 2 KB icons do not. Ties break
 * by name, and then by id, so a report does not shuffle between two readings of the same build.
 */
export function groupShippedAssets(entries: readonly ShippedAssetReportEntry[]): ShippedAssetGroup[] {
    const byType = new Map<string, ShippedAssetReportEntry[]>();
    for (const entry of entries) {
        const bucket = byType.get(entry.type);
        if (bucket) {
            bucket.push(entry);
        } else {
            byType.set(entry.type, [entry]);
        }
    }
    return [...byType.entries()]
        .map(([type, bucket]) => ({
            type,
            entries: [...bucket].sort(compareShippedAssets),
            bytes: totalShippedAssetBytes(bucket),
        }))
        .sort((a, b) => b.bytes - a.bytes || a.type.localeCompare(b.type));
}

function compareShippedAssets(a: ShippedAssetReportEntry, b: ShippedAssetReportEntry): number {
    return (b.bytes ?? 0) - (a.bytes ?? 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * How long the run took, as a short readout.
 *
 * Empty where the snapshot does not carry both stamps - a run refused before it started has no
 * duration to state, and "0s" would claim it ran.
 */
export function formatBuildDuration(state: GameBuildStateSnapshot, t: Translator["t"]): string {
    if (state.startedAt === undefined || state.finishedAt === undefined) {
        return "";
    }
    const totalSeconds = Math.max(0, state.finishedAt - state.startedAt) / 1000;
    if (totalSeconds < 60) {
        return t("build.report.durationSeconds", { seconds: totalSeconds.toFixed(1) });
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds - minutes * 60);
    return t("build.report.durationMinutes", { minutes, seconds: String(seconds).padStart(2, "0") });
}

/**
 * The asset report of a finished run, or null where the run narrowed nothing.
 *
 * Null is the answer for every run that packaged the library as it stands, and for a snapshot
 * written before builds reported this at all. It is not an empty report: an empty report would say
 * the run carried no assets, which is the opposite of what happened.
 */
export function shippedAssetReport(state: GameBuildStateSnapshot): ShippedAssetReport | null {
    return state.assetReport ?? null;
}
