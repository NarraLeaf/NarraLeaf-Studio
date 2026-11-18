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
    /** Numeric views of the core fields; precedence uses `raw` for full integer precision. */
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

function coreVersion(version: SemVer): [bigint, bigint, bigint] {
    const [major, minor, patch] = version.raw.split(/[.+-]/, 3);
    return [BigInt(major), BigInt(minor), BigInt(patch)];
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

    const leftCore = coreVersion(left);
    const rightCore = coreVersion(right);
    for (let index = 0; index < leftCore.length; index += 1) {
        if (leftCore[index] !== rightCore[index]) return leftCore[index] < rightCore[index] ? -1 : 1;
    }

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
        const an = BigInt(a);
        const bn = BigInt(b);
        return an === bn ? 0 : an < bn ? -1 : 1;
    }
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Test a version against a semver *range*, for the `studioVersion` field a
 * registry entry declares ("which Studio builds can run this plugin").
 *
 * Supports the subset of the npm range grammar a plugin author realistically
 * writes: `*`, exact versions, the `> >= < <= =` comparators, `^`, `~`,
 * space-separated AND, and `||` OR. Whitespace between an operator and its
 * version (`>= 1.2.0`) is tolerated.
 *
 * Two deliberate departures from npm, both toward permissiveness, because a
 * false negative here *blocks an install the registry vouched for*:
 *  - A range this parser cannot make sense of is treated as `*`. Registry CI
 *    validates the field; a range Studio fails to understand must not be the
 *    thing that stops a user installing.
 *  - Prereleases participate normally, so a nightly `0.2.0-beta.1` still
 *    satisfies `>=0.1.0`. npm would exclude it; for a desktop app that would
 *    lock every beta user out of the store.
 */
export function satisfiesRange(version: string, range: string | undefined | null): boolean {
    const parsed = parseSemver(version);
    if (!parsed) {
        return true;
    }
    const text = typeof range === "string" ? range.trim() : "";
    if (!text || text === "*" || text.toLowerCase() === "x") {
        return true;
    }
    // Glue each operator to its version so a clause splits cleanly on whitespace.
    const normalized = text.replace(/([<>=^~]+)\s+/g, "$1");
    return normalized
        .split("||")
        .some(clause => {
            const comparators = clause.trim().split(/\s+/).filter(Boolean);
            return comparators.every(comparator => satisfiesComparator(version, comparator));
        });
}

/** One comparator of a range. An unrecognized comparator is treated as satisfied. */
function satisfiesComparator(version: string, comparator: string): boolean {
    if (comparator === "*" || comparator.toLowerCase() === "x") {
        return true;
    }
    const match = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(comparator);
    if (!match) {
        return true;
    }
    const [, operator = "=", operand] = match;
    const target = parseSemver(operand);
    if (!target) {
        return true;
    }
    const cmp = compareSemver(version, target.raw);
    switch (operator) {
        case ">":
            return cmp > 0;
        case ">=":
            return cmp >= 0;
        case "<":
            return cmp < 0;
        case "<=":
            return cmp <= 0;
        case "^":
            return cmp >= 0 && compareSemver(version, caretCeiling(target)) < 0;
        case "~": {
            const [major, minor] = coreVersion(target);
            return cmp >= 0 && compareSemver(version, `${major}.${minor + 1n}.0`) < 0;
        }
        default:
            return cmp === 0;
    }
}

/**
 * The exclusive upper bound of `^`: the next version that may break. Below 1.0.0
 * semver treats the leading non-zero as the breaking digit, so `^0.2.1` allows
 * 0.2.x but not 0.3.0, and `^0.0.3` allows nothing but 0.0.3.
 */
function caretCeiling(target: SemVer): string {
    const [major, minor, patch] = coreVersion(target);
    if (major > 0n) {
        return `${major + 1n}.0.0`;
    }
    if (minor > 0n) {
        return `0.${minor + 1n}.0`;
    }
    return `0.0.${patch + 1n}`;
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
    if (coreVersion(authored)[0] !== coreVersion(installed)[0]) {
        return "incompatible";
    }
    if (compareSemver(installedVersion, authoredVersion) < 0) {
        return "outdated";
    }
    return "satisfied";
}
