/**
 * Minimal semver parsing and comparison, tailored to the plugin version format
 * enforced by {@link file://./pluginManifest.ts} `VERSION_PATTERN`
 * (`major.minor.patch` with an optional `-prerelease` and/or `+build` suffix).
 *
 * We deliberately avoid pulling in the full `semver` npm package: plugin
 * versions are already shape-validated at install time, and the only questions
 * the dependency resolver asks are "same major?" and "is the installed version
 * older than the one the project was authored against?".
 */

export interface SemVer {
    major: number;
    minor: number;
    patch: number;
    /** Dot-separated prerelease identifiers, empty when the version is a release. */
    prerelease: string[];
    /** Raw build metadata (ignored for precedence, per semver). */
    build: string;
    raw: string;
}

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseSemver(value: unknown): SemVer | null {
    if (typeof value !== "string") {
        return null;
    }
    const match = SEMVER_PATTERN.exec(value.trim());
    if (!match) {
        return null;
    }
    const [, major, minor, patch, prerelease, build] = match;
    return {
        major: Number(major),
        minor: Number(minor),
        patch: Number(patch),
        prerelease: prerelease ? prerelease.split(".") : [],
        build: build ?? "",
        raw: value.trim(),
    };
}

/**
 * Compare two semver strings. Returns -1 if a < b, 1 if a > b, 0 if equal.
 * Unparseable versions sort before parseable ones so they never look "newer".
 * Build metadata is ignored; prerelease precedence follows the semver spec.
 */
export function compareSemver(a: string, b: string): number {
    const left = parseSemver(a);
    const right = parseSemver(b);
    if (!left && !right) return 0;
    if (!left) return -1;
    if (!right) return 1;

    if (left.major !== right.major) return left.major < right.major ? -1 : 1;
    if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
    if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;

    return comparePrerelease(left.prerelease, right.prerelease);
}

function comparePrerelease(a: string[], b: string[]): number {
    // A release (no prerelease) has higher precedence than any prerelease.
    if (a.length === 0 && b.length === 0) return 0;
    if (a.length === 0) return 1;
    if (b.length === 0) return -1;

    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
        const cmp = comparePrereleaseIdentifier(a[index], b[index]);
        if (cmp !== 0) return cmp;
    }
    if (a.length === b.length) return 0;
    return a.length < b.length ? -1 : 1;
}

function comparePrereleaseIdentifier(a: string, b: string): number {
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
        const an = Number(a);
        const bn = Number(b);
        return an === bn ? 0 : an < bn ? -1 : 1;
    }
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return a === b ? 0 : a < b ? -1 : 1;
}

export type CompatibilityVerdict = "satisfied" | "outdated" | "incompatible";

/**
 * Classify how the installed plugin version relates to the version the project
 * was authored against, per the locked policy:
 * - different major             → "incompatible" (breaking; drives suppression)
 * - same major, installed older → "outdated" (warn only)
 * - otherwise                   → "satisfied"
 *
 * If either version is unparseable we conservatively return "incompatible":
 * we cannot prove the installed plugin is safe, and the cost of a false
 * positive (a warning) is far lower than loading a truly broken plugin.
 */
export function classifyCompatibility(authoredVersion: string, installedVersion: string): CompatibilityVerdict {
    const authored = parseSemver(authoredVersion);
    const installed = parseSemver(installedVersion);
    if (!authored || !installed) {
        return "incompatible";
    }
    if (authored.major !== installed.major) {
        return "incompatible";
    }
    if (compareSemver(installedVersion, authoredVersion) < 0) {
        return "outdated";
    }
    return "satisfied";
}
