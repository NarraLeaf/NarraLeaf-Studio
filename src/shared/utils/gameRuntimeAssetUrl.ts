/**
 * Asset ids are stable identifiers (UUIDs assigned at import), not content
 * digests, and the game runtime's HTTP cache can outlive a recompile (preview
 * keeps its userData dir across runs). Asset URLs therefore carry a per-pack
 * version query so long-lived immutable cache entries can never leak stale
 * bytes into a newer pack. The protocol handler resolves assets by pathname
 * alone and ignores the query entirely.
 *
 * The version travels from the runtime main process to the preload via a
 * process argument (`additionalArguments`), which is the only synchronous
 * channel available before the renderer loads.
 */
export const GAME_RUNTIME_ASSET_VERSION_ARG = "--nls-asset-version";

export function buildGameRuntimeAssetVersionArg(version: string): string {
    return `${GAME_RUNTIME_ASSET_VERSION_ARG}=${version}`;
}

export function readGameRuntimeAssetVersionArg(argv: readonly string[]): string | null {
    const prefix = `${GAME_RUNTIME_ASSET_VERSION_ARG}=`;
    const match = argv.find(arg => arg.startsWith(prefix));
    const value = match ? match.slice(prefix.length).trim() : "";
    return value || null;
}

/**
 * The crash policy, handed to the renderer the same way and for the same kind of reason: it has to
 * be answerable before anything has been read from disk. The screen most likely to need it is the
 * one drawn when reading the pack is what failed.
 */
export const GAME_RUNTIME_CRASH_POLICY_ARG = "--nls-crash-policy";

export function buildGameRuntimeCrashPolicyArg(policy: string): string {
    return `${GAME_RUNTIME_CRASH_POLICY_ARG}=${policy}`;
}

export function readGameRuntimeCrashPolicyArg(argv: readonly string[]): string | null {
    const prefix = `${GAME_RUNTIME_CRASH_POLICY_ARG}=`;
    const found = argv.find(arg => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : null;
}

/** Where the shell writes its log, handed over the same way and for the same reason. */
export const GAME_RUNTIME_LOG_PATH_ARG = "--nls-log-path";

export function buildGameRuntimeLogPathArg(logPath: string): string {
    return `${GAME_RUNTIME_LOG_PATH_ARG}=${logPath}`;
}

export function readGameRuntimeLogPathArg(argv: readonly string[]): string | null {
    const prefix = `${GAME_RUNTIME_LOG_PATH_ARG}=`;
    const found = argv.find(arg => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : null;
}
