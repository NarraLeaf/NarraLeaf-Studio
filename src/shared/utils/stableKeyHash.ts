/**
 * FNV-1a (64-bit) rendered in base36.
 *
 * Global-state keys are validated against `/^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$/` (see
 * `PersistentState.ensureValidKey`), so anything derived from a filesystem path has to be folded
 * into an alphanumeric token before it can be used as a key segment. Base36 keeps that guarantee.
 *
 * This is a keying primitive, not a security or integrity one - it only needs to be stable across
 * runs and collision-free in practice for the handful of projects one user opens.
 */
export function stableKeyHash(value: string): string {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= BigInt(value.charCodeAt(i));
        hash = BigInt.asUintN(64, hash * prime);
    }
    return hash.toString(36);
}

/**
 * Fold a project reference into the stable token shared by every per-project settings key.
 *
 * The identifier is included ahead of the path so that moving a project directory keeps the two
 * apart rather than silently inheriting the previous occupant's data.
 */
export function stableProjectKeyToken(projectRef: {
    projectPath: string;
    projectIdentifier?: string | null;
}): string {
    const normalized = projectRef.projectPath.trim().replace(/\\/g, "/");
    const projectPath = normalized.length <= 1 ? normalized : normalized.replace(/\/+$/g, "");
    const projectIdentifier = projectRef.projectIdentifier?.trim() ?? "";
    return stableKeyHash(`${projectIdentifier}\0${projectPath}`);
}
