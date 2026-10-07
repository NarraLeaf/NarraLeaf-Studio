/**
 * Compare two `X.Y.Z` versions, ignoring any pre-release suffix beyond ordering it below the
 * release it belongs to. Returns >0 when `a` is newer.
 *
 * Hand-rolled rather than pulled from `semver`, which is only in the tree as somebody else's
 * transitive dependency - importing it here would make an update check depend on a package this
 * app never declared, and it would keep working right up until a fresh install hoisted it
 * somewhere else. The comparison Studio needs is the whole of what its own tags use.
 */
export function compareVersions(a: string, b: string): number {
    const parse = (value: string) => {
        const [core, prerelease] = value.replace(/^v/i, "").split("-", 2);
        const parts = core.split(".").map(part => Number.parseInt(part, 10) || 0);
        return { parts, prerelease: prerelease ?? "" };
    };
    const left = parse(a);
    const right = parse(b);
    for (let index = 0; index < 3; index += 1) {
        const diff = (left.parts[index] ?? 0) - (right.parts[index] ?? 0);
        if (diff !== 0) {
            return diff > 0 ? 1 : -1;
        }
    }
    // 1.0.0 beats 1.0.0-rc1; two pre-releases of the same version compare lexically, which is
    // enough to stop Studio offering someone the build they are already running.
    if (left.prerelease === right.prerelease) {
        return 0;
    }
    if (!left.prerelease) {
        return 1;
    }
    if (!right.prerelease) {
        return -1;
    }
    return left.prerelease > right.prerelease ? 1 : -1;
}
